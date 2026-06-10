import { z } from "zod";

// ─────────────────────────────────────────────────────────
// POST /api/orders  —  request body validation
// ─────────────────────────────────────────────────────────

export const createOrderItemSchema = z.object({
  serviceId: z.string().uuid(),
  quantity: z.number().int().positive().max(100),
});

export const createOrderSchema = z.object({
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
