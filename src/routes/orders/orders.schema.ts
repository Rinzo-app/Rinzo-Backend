import { z } from "zod";

// ─────────────────────────────────────────────────────────
// Pickup scheduling — canonical slots (India local time, IST)
//
// These are the ONLY accepted pickup windows. start/end are 24h
// IST hours. The label is what the apps display and send back.
// India has no DST, so a fixed +05:30 offset is exact.
// ─────────────────────────────────────────────────────────
export const PICKUP_SLOTS = [
  { label: "8 - 10 AM", start: 8, end: 10 },
  { label: "10 AM - 12 PM", start: 10, end: 12 },
  { label: "12 - 2 PM", start: 12, end: 14 },
  { label: "2 - 4 PM", start: 14, end: 16 },
  { label: "4 - 6 PM", start: 16, end: 18 },
  { label: "6 - 8 PM", start: 18, end: 20 },
] as const;

const SLOT_BY_LABEL = new Map<string, { label: string; start: number; end: number }>(
  PICKUP_SLOTS.map((s) => [s.label, s]),
);
const IST_OFFSET_MS = 330 * 60 * 1000; // +05:30
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** UTC epoch ms for the END of a slot on an IST calendar date. */
export function slotEndUtcMs(dateStr: string, endHourIst: number): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  // Treat the wall-clock IST time as if UTC, then shift back by the offset.
  return Date.UTC(y, m - 1, d, endHourIst, 0, 0) - IST_OFFSET_MS;
}

// ─────────────────────────────────────────────────────────
// POST /api/orders  —  request body validation
// ─────────────────────────────────────────────────────────

export const createOrderItemSchema = z.object({
  serviceId: z.string().uuid(),
  quantity: z.number().int().positive().max(100),
});

export const createOrderSchema = z
  .object({
    shopId: z.string().uuid(),
    items: z.array(createOrderItemSchema).min(1, "At least one item is required").max(50),
    pickupAddress: z.string().min(1, "Pickup address is required").max(500),
    deliveryAddress: z.string().min(1, "Delivery address is required").max(500),
    // Optional customer coordinates — used to compute delivery fee
    pickupLat: z.number().min(-90).max(90).optional(),
    pickupLng: z.number().min(-180).max(180).optional(),
    // Optional scheduling fields
    pickupDate: z.string().max(20).optional(),
    pickupSlot: z.string().max(50).optional(),
    // Client-generated dedupe key (e.g. a UUID per checkout attempt)
    idempotencyKey: z.string().min(8).max(64).optional(),
  })
  .superRefine((b, ctx) => {
    // Validate pickup date format when present.
    if (b.pickupDate !== undefined && !DATE_RE.test(b.pickupDate)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pickupDate"],
        message: "Pickup date must be YYYY-MM-DD",
      });
      return;
    }
    // Validate the slot is one we offer.
    if (b.pickupSlot !== undefined && !SLOT_BY_LABEL.has(b.pickupSlot)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pickupSlot"],
        message: "Unknown pickup time slot",
      });
      return;
    }
    // When both are given, the slot must not have already ended.
    if (b.pickupDate && b.pickupSlot) {
      const slot = SLOT_BY_LABEL.get(b.pickupSlot)!;
      // 5-minute grace so a click right at the boundary isn't rejected.
      if (slotEndUtcMs(b.pickupDate, slot.end) <= Date.now() - 5 * 60 * 1000) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["pickupSlot"],
          message: "That pickup time is in the past — pick a later slot",
        });
      }
    }
  });

export type CreateOrderInput = z.infer<typeof createOrderSchema>;

// ─────────────────────────────────────────────────────────
// POST /api/orders/:id/reject  —  request body validation
// ─────────────────────────────────────────────────────────

export const rejectOrderSchema = z.object({
  rejectionReason: z.enum([
    "CAPACITY_FULL",
    "CLOSED_TEMPORARILY",
    "SERVICE_UNAVAILABLE",
    "EMERGENCY",
  ]),
});

export type RejectOrderInput = z.infer<typeof rejectOrderSchema>;
