import type { Response, NextFunction } from "express";
import { eq, and, count } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { orders } from "../../db/schema/orders.js";
import { orderEvents } from "../../db/schema/order-events.js";
import { riders } from "../../db/schema/riders.js";
import { users } from "../../db/schema/users.js";
import { shops } from "../../db/schema/shops.js";
import { ledgerEntries } from "../../db/schema/ledger-entries.js";
import { payments } from "../../db/schema/payments.js";
import type { AuthenticatedRequest } from "../../lib/types.js";
import {
  NotFoundError,
  ForbiddenError,
  BadRequestError,
  ConflictError,
} from "../../lib/errors.js";
import { parseUUID } from "../../lib/validate-uuid.js";
import { storageImageUrl, isAllowedStorageUrl } from "../../lib/validate-image-url.js";
import type { OrderStatus } from "../../lib/order-machine.js";
import { assertTransition } from "../../lib/order-machine.js";
import { resolveRiderLegDistanceKm } from "../../lib/rider-distance.js";
import { releasePickupOffer, releaseDeliveryOffer } from "../../lib/auto-assign.js";
import { bookCodCollection } from "../../lib/cod-collection.js";
import { getPricing } from "../../lib/pricing-config.js";
import { notifyUserAsync } from "../../lib/push.js";

const availabilitySchema = z.object({
  isAvailable: z.boolean(),
});

// ─────────────────────────────────────────────────────────
// GET /api/rider/profile
// Returns the authenticated rider's profile (joined user + rider data).
// ─────────────────────────────────────────────────────────

export async function getRiderProfile(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const [rider] = await db
      .select({
        riderId: riders.id,
        vehicleType: riders.vehicleType,
        vehicleNumber: riders.vehicleNumber,
        licenseNumber: riders.licenseNumber,
        dlImageUrl: riders.dlImageUrl,
        rcImageUrl: riders.rcImageUrl,
        selfieUrl: riders.selfieUrl,
        documentsStatus: riders.documentsStatus,
        documentsRejectionReason: riders.documentsRejectionReason,
        riderStatus: riders.status,
        isAvailable: riders.isAvailable,
      })
      .from(riders)
      .where(eq(riders.userId, req.user.id))
      .limit(1);

    if (!rider) {
      throw new NotFoundError(
        "Rider profile not found for this user",
        "ERR_RIDER_NOT_FOUND",
      );
    }

    const [user] = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        phone: users.phone,
        userStatus: users.status,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, req.user.id))
      .limit(1);

    // Rider status takes priority; fall back to user status
    const effectiveStatus = rider.riderStatus ?? user?.userStatus ?? "PENDING";

    // Count completed deliveries for this rider
    const [{ total }] = await db
      .select({ total: count() })
      .from(orders)
      .where(
        and(
          eq(orders.riderId, rider.riderId),
          eq(orders.status, "DELIVERED"),
        ),
      );

    res.status(200).json({
      id: user?.id ?? req.user.id,
      riderId: rider.riderId,
      name: user?.name ?? "",
      email: user?.email ?? "",
      phone: user?.phone ?? null,
      status: effectiveStatus,
      vehicleType: rider.vehicleType,
      vehicleNumber: rider.vehicleNumber ?? "",
      licenseNumber: rider.licenseNumber ?? "",
      dlImageUrl: rider.dlImageUrl ?? null,
      rcImageUrl: rider.rcImageUrl ?? null,
      selfieUrl: rider.selfieUrl ?? null,
      documentsStatus: rider.documentsStatus,
      documentsRejectionReason: rider.documentsRejectionReason ?? null,
      availability: rider.isAvailable ? "AVAILABLE" : "OFFLINE",
      joinedDate: user?.createdAt?.toISOString() ?? new Date().toISOString(),
      totalDeliveries: total,
    });
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────
// PATCH /api/rider/documents
// Rider submits KYC document image URLs (already uploaded to
// Firebase Storage by the client). Sets status to SUBMITTED for
// admin review and clears any prior rejection.
// ─────────────────────────────────────────────────────────

const documentsSchema = z
  .object({
    dlImageUrl: storageImageUrl.optional(),
    rcImageUrl: storageImageUrl.optional(),
    selfieUrl: storageImageUrl.optional(),
  })
  .refine(
    (b) => b.dlImageUrl || b.rcImageUrl || b.selfieUrl,
    { message: "Provide at least one document image" },
  );

export async function submitDocuments(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = documentsSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError(
        parsed.error.issues.map((i) => i.message).join("; "),
      );
    }

    const rider = await getRiderForUser(req.user.id);

    const [updated] = await db
      .update(riders)
      .set({
        ...(parsed.data.dlImageUrl !== undefined ? { dlImageUrl: parsed.data.dlImageUrl } : {}),
        ...(parsed.data.rcImageUrl !== undefined ? { rcImageUrl: parsed.data.rcImageUrl } : {}),
        ...(parsed.data.selfieUrl !== undefined ? { selfieUrl: parsed.data.selfieUrl } : {}),
        documentsStatus: "SUBMITTED",
        documentsRejectionReason: null,
      })
      .where(eq(riders.id, rider.id))
      .returning();

    res.status(200).json({
      dlImageUrl: updated.dlImageUrl,
      rcImageUrl: updated.rcImageUrl,
      selfieUrl: updated.selfieUrl,
      documentsStatus: updated.documentsStatus,
    });
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────
// PATCH /api/rider/profile
// Update vehicle details (type, registration number, license).
// ─────────────────────────────────────────────────────────

const updateProfileSchema = z
  .object({
    vehicleType: z.enum(["Motorcycle", "Scooter", "Bicycle", "Car"]).optional(),
    vehicleNumber: z
      .string()
      .trim()
      .max(30)
      .regex(/^[A-Za-z0-9 -]*$/, "Vehicle number can only contain letters, digits, spaces and dashes")
      .optional(),
    licenseNumber: z
      .string()
      .trim()
      .max(30)
      .regex(/^[A-Za-z0-9 -]*$/, "License number can only contain letters, digits, spaces and dashes")
      .optional(),
  })
  .refine(
    (b) => b.vehicleType !== undefined || b.vehicleNumber !== undefined || b.licenseNumber !== undefined,
    { message: "Provide at least one field to update" },
  );

export async function updateRiderProfile(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = updateProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError(
        parsed.error.issues.map((i) => i.message).join("; "),
      );
    }

    const rider = await getRiderForUser(req.user.id);

    const [updated] = await db
      .update(riders)
      .set({
        ...(parsed.data.vehicleType !== undefined ? { vehicleType: parsed.data.vehicleType } : {}),
        ...(parsed.data.vehicleNumber !== undefined
          ? { vehicleNumber: parsed.data.vehicleNumber.toUpperCase() }
          : {}),
        ...(parsed.data.licenseNumber !== undefined
          ? { licenseNumber: parsed.data.licenseNumber.toUpperCase() }
          : {}),
      })
      .where(eq(riders.id, rider.id))
      .returning();

    res.status(200).json({
      vehicleType: updated.vehicleType,
      vehicleNumber: updated.vehicleNumber,
      licenseNumber: updated.licenseNumber,
    });
  } catch (err) {
    next(err);
  }
}

const locationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

/** Resolve the riders row for the authenticated user. */
async function getRiderForUser(userId: string) {
  const [rider] = await db
    .select()
    .from(riders)
    .where(eq(riders.userId, userId))
    .limit(1);

  if (!rider) {
    throw new NotFoundError(
      "Rider profile not found for this user",
      "ERR_RIDER_NOT_FOUND",
    );
  }
  return rider;
}

/** Fetch order & verify the rider is assigned to it. */
async function getOrderForRider(orderId: string, riderId: string) {
  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!order) {
    throw new NotFoundError("Order not found", "ERR_ORDER_NOT_FOUND");
  }

  if (order.riderId !== riderId) {
    throw new ForbiddenError(
      "You are not assigned to this order",
      "ERR_RIDER_NOT_ASSIGNED",
    );
  }

  return order;
}

// ─────────────────────────────────────────────────────────
// POST /api/rider/availability
// ─────────────────────────────────────────────────────────

export async function toggleAvailability(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = availabilitySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError(
        parsed.error.issues.map((i) => i.message).join("; "),
      );
    }

    const rider = await getRiderForUser(req.user.id);

    const [updated] = await db
      .update(riders)
      .set({ isAvailable: parsed.data.isAvailable })
      .where(eq(riders.id, rider.id))
      .returning();

    res.status(200).json(updated);
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────
// POST /api/rider/location
// ─────────────────────────────────────────────────────────

export async function updateLocation(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = locationSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError(
        parsed.error.issues.map((i) => i.message).join("; "),
      );
    }

    const rider = await getRiderForUser(req.user.id);

    const [updated] = await db
      .update(riders)
      .set({
        lastLat: parsed.data.lat,
        lastLng: parsed.data.lng,
        locationUpdatedAt: new Date(),
      })
      .where(eq(riders.id, rider.id))
      .returning();

    res.status(200).json({ ok: true, locationUpdatedAt: updated.locationUpdatedAt });
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────
// POST /api/rider/orders/:id/accept
// PICKUP_OFFERED   → PICKUP_ASSIGNED   (rider accepts pickup)
// DELIVERY_OFFERED → OUT_FOR_DELIVERY  (rider accepts delivery)
// ─────────────────────────────────────────────────────────

export async function acceptOffer(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const orderId = parseUUID(req.params.id as string, "order ID");
    const rider = await getRiderForUser(req.user.id);
    const order = await getOrderForRider(orderId, rider.id);

    const isDelivery = order.status === "DELIVERY_OFFERED";
    const fromStatus: OrderStatus = isDelivery ? "DELIVERY_OFFERED" : "PICKUP_OFFERED";
    const toStatus: OrderStatus = isDelivery ? "OUT_FOR_DELIVERY" : "PICKUP_ASSIGNED";

    assertTransition(order.status as OrderStatus, toStatus, "RIDER");

    // Expired offer — release it (cascades to the next rider) and
    // tell this rider it's gone.
    if (order.offerExpiresAt && order.offerExpiresAt.getTime() < Date.now()) {
      if (isDelivery) {
        await releaseDeliveryOffer(orderId, rider.id, req.user.id, "SYSTEM");
      } else {
        await releasePickupOffer(orderId, rider.id, req.user.id, "SYSTEM");
      }
      throw new ConflictError(
        "This offer has expired and was passed to another rider",
        "ERR_OFFER_EXPIRED",
      );
    }

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(orders)
        .set({
          status: toStatus,
          offerExpiresAt: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(orders.id, orderId),
            eq(orders.status, fromStatus),
            eq(orders.riderId, rider.id),
          ),
        )
        .returning();

      if (!row) {
        throw new ConflictError(
          "Offer is no longer available",
          "ERR_OFFER_GONE",
        );
      }

      await tx.insert(orderEvents).values({
        orderId,
        fromStatus,
        toStatus,
        actor: "RIDER",
        actorId: req.user.id,
      });

      return row;
    });

    if (isDelivery) {
      notifyUserAsync(
        order.customerId,
        "Out for delivery 🚚",
        "A rider has your fresh laundry and is on the way back to you.",
        { type: "ORDER_OUT_FOR_DELIVERY", orderId },
      );
    } else {
      notifyUserAsync(
        order.customerId,
        "Rider on the way 🛵",
        "A rider has accepted your pickup and is heading your way.",
        { type: "PICKUP_ACCEPTED", orderId },
      );
    }

    res.status(200).json(updated);
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────
// POST /api/rider/orders/:id/decline
// PICKUP_OFFERED   → SHOP_ACCEPTED  (pickup passes to next rider)
// DELIVERY_OFFERED → READY          (delivery passes to next rider)
// ─────────────────────────────────────────────────────────

export async function declineOffer(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const orderId = parseUUID(req.params.id as string, "order ID");
    const rider = await getRiderForUser(req.user.id);
    const order = await getOrderForRider(orderId, rider.id);

    const released =
      order.status === "DELIVERY_OFFERED"
        ? await releaseDeliveryOffer(orderId, rider.id, req.user.id, "RIDER")
        : order.status === "PICKUP_OFFERED"
          ? await releasePickupOffer(orderId, rider.id, req.user.id, "RIDER")
          : null;

    if (released === null) {
      throw new ConflictError(
        "There is no pending offer on this order",
        "ERR_NO_PENDING_OFFER",
      );
    }
    if (!released) {
      throw new ConflictError(
        "Offer is no longer available",
        "ERR_OFFER_GONE",
      );
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────
// POST /api/rider/orders/:id/pickup
// PICKUP_ASSIGNED → PICKED_UP_FROM_CUSTOMER
// ─────────────────────────────────────────────────────────

export async function pickupOrder(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const orderId = parseUUID(req.params.id as string, "order ID");
    const rider = await getRiderForUser(req.user.id);
    const order = await getOrderForRider(orderId, rider.id);

    // ── Validate transition ─────────────────────────────
    assertTransition(
      order.status as OrderStatus,
      "PICKED_UP_FROM_CUSTOMER",
      "RIDER",
    );

    // ── Update in transaction ─────────────────────────────
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(orders)
        .set({
          status: "PICKED_UP_FROM_CUSTOMER",
          updatedAt: new Date(),
        })
        .where(and(eq(orders.id, orderId), eq(orders.status, order.status as OrderStatus)))
        .returning();

      if (!row) {
        throw new ConflictError(
          "Order status changed concurrently — please retry",
          "ERR_ORDER_RACE",
        );
      }

      await tx.insert(orderEvents).values({
        orderId,
        fromStatus: order.status as OrderStatus,
        toStatus: "PICKED_UP_FROM_CUSTOMER",
        actor: "RIDER",
        actorId: req.user.id,
      });

      // ── Rider pickup-leg payout ─────────────────────────
      await insertRiderLegPayout(tx, {
        orderId,
        riderId: rider.id,
        shopId: order.shopId,
        deliveryFee: order.deliveryFee,
        pickupLat: order.pickupLat,
        pickupLng: order.pickupLng,
        riderLastLat: rider.lastLat,
        riderLastLng: rider.lastLng,
        leg: "PICKUP",
      });

      return row;
    });

    notifyUserAsync(
      order.customerId,
      "Clothes picked up 👕",
      "Your rider has collected your laundry and is heading to the shop.",
      { type: "ORDER_PICKED_UP", orderId },
    );

    res.status(200).json(updated);
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────
// POST /api/rider/orders/:id/dropoff
// PICKED_UP_FROM_CUSTOMER → AT_SHOP
// ─────────────────────────────────────────────────────────

export async function dropoffOrder(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const orderId = parseUUID(req.params.id as string, "order ID");
    const rider = await getRiderForUser(req.user.id);
    const order = await getOrderForRider(orderId, rider.id);

    // ── Validate transition ─────────────────────────────
    assertTransition(
      order.status as OrderStatus,
      "AT_SHOP",
      "RIDER",
    );

    // ── Update in transaction ─────────────────────────────
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(orders)
        .set({
          status: "AT_SHOP",
          updatedAt: new Date(),
        })
        .where(and(eq(orders.id, orderId), eq(orders.status, order.status as OrderStatus)))
        .returning();

      if (!row) {
        throw new ConflictError(
          "Order status changed concurrently — please retry",
          "ERR_ORDER_RACE",
        );
      }

      await tx.insert(orderEvents).values({
        orderId,
        fromStatus: order.status as OrderStatus,
        toStatus: "AT_SHOP",
        actor: "RIDER",
        actorId: req.user.id,
      });

      return row;
    });

    res.status(200).json(updated);
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────
// POST /api/rider/orders/:id/deliver
// OUT_FOR_DELIVERY → DELIVERED
// ─────────────────────────────────────────────────────────

export async function deliverOrder(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const orderId = parseUUID(req.params.id as string, "order ID");
    const rider = await getRiderForUser(req.user.id);
    const order = await getOrderForRider(orderId, rider.id);

    // ── Optional proof-of-delivery photo ────────────────
    // Only accept a download URL for our own Storage bucket; an
    // invalid/foreign URL is ignored rather than failing the handover.
    const rawProof =
      typeof req.body?.deliveryProofUrl === "string"
        ? req.body.deliveryProofUrl.trim()
        : "";
    const proofUrl =
      rawProof && rawProof.length <= 1000 && isAllowedStorageUrl(rawProof)
        ? rawProof
        : null;

    // ── Proof-of-delivery is mandatory ──────────────────
    // A photo at handover is required to confirm delivery — it's the
    // record that the laundry actually reached the customer.
    if (!proofUrl) {
      throw new BadRequestError(
        "A delivery photo is required to confirm handover",
        "ERR_PROOF_REQUIRED",
      );
    }

    // ── Validate transition ─────────────────────────────
    assertTransition(
      order.status as OrderStatus,
      "DELIVERED",
      "RIDER",
    );

    // ── Update in transaction ─────────────────────────────
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(orders)
        .set({
          status: "DELIVERED",
          updatedAt: new Date(),
          ...(proofUrl ? { deliveryProofUrl: proofUrl } : {}),
        })
        .where(and(eq(orders.id, orderId), eq(orders.status, order.status as OrderStatus)))
        .returning();

      if (!row) {
        throw new ConflictError(
          "Order status changed concurrently — please retry",
          "ERR_ORDER_RACE",
        );
      }

      await tx.insert(orderEvents).values({
        orderId,
        fromStatus: order.status as OrderStatus,
        toStatus: "DELIVERED",
        actor: "RIDER",
        actorId: req.user.id,
      });

      // ── Rider delivery-leg payout ───────────────────────
      await insertRiderLegPayout(tx, {
        orderId,
        riderId: rider.id,
        shopId: order.shopId,
        deliveryFee: order.deliveryFee,
        pickupLat: order.pickupLat,
        pickupLng: order.pickupLng,
        riderLastLat: rider.lastLat,
        riderLastLng: rider.lastLng,
        leg: "DROP",
      });

      // ── Rider keeps 100% of the customer's tip ──────────
      if (order.tipAmount > 0) {
        const existing = await tx
          .select({ details: ledgerEntries.details })
          .from(ledgerEntries)
          .where(
            and(
              eq(ledgerEntries.orderId, orderId),
              eq(ledgerEntries.entityType, "RIDER"),
              eq(ledgerEntries.entityId, rider.id),
              eq(ledgerEntries.reason, "EARNING"),
            ),
          );
        const tipBooked = existing.some(
          (e) => (e.details as { leg?: string } | null)?.leg === "TIP",
        );
        if (!tipBooked) {
          await tx.insert(ledgerEntries).values({
            entityType: "RIDER",
            entityId: rider.id,
            orderId,
            amount: order.tipAmount,
            reason: "EARNING",
            details: { leg: "TIP" },
          });
        }
      }

      return row;
    });

    notifyUserAsync(
      order.customerId,
      "Delivered 🎉",
      "Your fresh laundry has been delivered. Thanks for using Rinzo!",
      { type: "ORDER_DELIVERED", orderId },
    );

    res.status(200).json(updated);
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────
// POST /api/rider/orders/:id/report-delay
//
// A rider stuck by traffic / breakdown / accident reports it instead
// of silently missing the SLA. Effects:
//  - suppresses the pickup auto-reassign (the sweeper skips orders with
//    a reported delay — the rider keeps the order),
//  - flags the order for admin immediately (sla_breached_at) with the
//    reason, so a human can call / help / reassign manually.
// ─────────────────────────────────────────────────────────

const DELAY_REASONS = [
  "TRAFFIC",
  "BREAKDOWN",
  "ACCIDENT",
  "CUSTOMER_UNREACHABLE",
  "OTHER",
] as const;

const DELAY_ACTIVE_STATUSES: OrderStatus[] = [
  "PICKUP_ASSIGNED",
  "PICKED_UP_FROM_CUSTOMER",
  "OUT_FOR_DELIVERY",
];

export async function reportDelay(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const orderId = parseUUID(req.params.id as string, "order ID");
    const rider = await getRiderForUser(req.user.id);
    const order = await getOrderForRider(orderId, rider.id);

    if (!DELAY_ACTIVE_STATUSES.includes(order.status as OrderStatus)) {
      throw new BadRequestError(
        "You can only report a delay on an active pickup or delivery",
        "ERR_NOT_ACTIVE_LEG",
      );
    }

    const reason =
      typeof req.body?.reason === "string"
        ? req.body.reason.trim().toUpperCase()
        : "";
    if (!(DELAY_REASONS as readonly string[]).includes(reason)) {
      throw new BadRequestError("Choose a valid delay reason", "ERR_INVALID_REASON");
    }
    const note =
      typeof req.body?.note === "string"
        ? req.body.note.trim().slice(0, 280) || null
        : null;

    const [row] = await db
      .update(orders)
      .set({
        delayReason: reason,
        delayNote: note,
        delayReportedAt: new Date(),
        // Surface to admin right away, even before the SLA window.
        slaBreachedAt: new Date(),
      })
      .where(eq(orders.id, orderId))
      .returning();

    console.warn(
      JSON.stringify({
        level: "warn",
        type: "RIDER_DELAY_REPORTED",
        orderId,
        riderId: rider.id,
        status: order.status,
        reason,
        ts: new Date().toISOString(),
      }),
    );

    res.status(200).json(row);
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────
// POST /api/rider/orders/:id/collect-cash
// Rider confirms the COD amount was collected at delivery.
// ─────────────────────────────────────────────────────────

export async function collectCash(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const orderId = parseUUID(req.params.id as string, "order ID");
    const rider = await getRiderForUser(req.user.id);
    const order = await getOrderForRider(orderId, rider.id);

    if (order.status !== "DELIVERED") {
      throw new ConflictError(
        "Cash can only be collected once the order is delivered",
        "ERR_ORDER_NOT_DELIVERED",
      );
    }

    const [payment] = await db
      .select()
      .from(payments)
      .where(eq(payments.orderId, orderId))
      .limit(1);
    if (!payment) {
      throw new NotFoundError("Payment record not found", "ERR_PAYMENT_NOT_FOUND");
    }
    if (payment.method !== "COD") {
      throw new ConflictError(
        "Only COD payments are collected in cash",
        "ERR_NOT_COD",
      );
    }
    if (payment.status !== "PENDING") {
      // Already collected (or settled) — idempotent success so the
      // app's auto-collect after deliver never errors on a retry.
      res.status(200).json(payment);
      return;
    }

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(payments)
        .set({
          status: "COLLECTED",
          collectedBy: `RIDER:${rider.id}`,
          collectedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(payments.orderId, orderId), eq(payments.status, "PENDING")))
        .returning();

      if (!row) return null; // raced with another collector — no double booking

      // Same revenue split the admin path books on collection
      await bookCodCollection(tx, {
        orderId,
        totalAmount: order.totalAmount,
        platformFee: order.platformFee,
        shopId: order.shopId,
      });

      return row;
    });

    res.status(200).json(updated ?? payment);
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────
// RIDER LEG PAYOUT — idempotent ledger insert
// ─────────────────────────────────────────────────────────

interface LegPayoutOpts {
  orderId: string;
  riderId: string;
  shopId: string;
  deliveryFee: number;
  pickupLat: number | null;
  pickupLng: number | null;
  riderLastLat: number | null;
  riderLastLng: number | null;
  leg: "PICKUP" | "DROP";
}

/**
 * Insert a single EARNING ledger entry for one rider leg.
 *
 * Distance priority (strict):
 *   1. GEO_CUSTOMER_SHOP  – haversine(customer ↔ shop)
 *   2. GEO_RIDER_SHOP     – haversine(rider ↔ shop)
 *   3. ESTIMATED_FROM_FEE  – deliveryFee / rate / 2
 *
 * Idempotency: checks for an existing entry matching
 * (orderId, riderId, leg) before inserting.
 */
async function insertRiderLegPayout(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  opts: LegPayoutOpts,
): Promise<void> {
  const {
    orderId,
    riderId,
    shopId,
    deliveryFee,
    pickupLat,
    pickupLng,
    riderLastLat,
    riderLastLng,
    leg,
  } = opts;

  try {
    // ── Idempotency guard ─────────────────────────────────
    const existingEntries = await tx
      .select({ id: ledgerEntries.id, details: ledgerEntries.details })
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.orderId, orderId),
          eq(ledgerEntries.entityType, "RIDER"),
          eq(ledgerEntries.entityId, riderId),
          eq(ledgerEntries.reason, "EARNING"),
        ),
      );

    for (const entry of existingEntries) {
      const d = entry.details as { leg?: string } | null;
      if (d?.leg === leg) return; // already recorded
    }

    // ── Fetch shop coordinates ────────────────────────────
    const [shop] = await tx
      .select({ latitude: shops.latitude, longitude: shops.longitude })
      .from(shops)
      .where(eq(shops.id, shopId))
      .limit(1);

    if (!shop) {
      console.warn(
        JSON.stringify({
          level: "warn",
          type: "RIDER_PAYOUT_SKIP",
          message: `Shop ${shopId} not found — cannot compute distance`,
          orderId,
          riderId,
          leg,
          ts: new Date().toISOString(),
        }),
      );
      return;
    }

    // ── Resolve distance via strict priority chain ────────
    const resolved = resolveRiderLegDistanceKm({
      leg,
      customer:
        pickupLat != null && pickupLng != null
          ? { lat: pickupLat, lng: pickupLng }
          : undefined,
      shop: { lat: shop.latitude, lng: shop.longitude },
      rider:
        riderLastLat != null && riderLastLng != null
          ? { lat: riderLastLat, lng: riderLastLng }
          : undefined,
      deliveryFeePaise: deliveryFee,
      deliveryRatePerKm: getPricing().deliveryRatePerKm,
    });

    if (!resolved) {
      console.warn(
        JSON.stringify({
          level: "warn",
          type: "RIDER_PAYOUT_SKIP",
          message: `Cannot compute distance for ${leg} leg — all sources exhausted`,
          orderId,
          riderId,
          ts: new Date().toISOString(),
        }),
      );
      return;
    }

    if (resolved.source === "ESTIMATED_FROM_FEE") {
      console.warn(
        JSON.stringify({
          level: "warn",
          type: "RIDER_PAYOUT_ESTIMATED",
          message: `Using estimated fee-based distance for ${leg} leg — no geo data`,
          orderId,
          riderId,
          distanceKm: resolved.distanceKm,
          ts: new Date().toISOString(),
        }),
      );
    }

    const riderPayoutPerKm = getPricing().riderPayoutPerKm;
    const payout = Math.round(resolved.distanceKm * riderPayoutPerKm);
    if (payout <= 0) return; // zero-distance edge case

    await tx.insert(ledgerEntries).values({
      entityType: "RIDER",
      entityId: riderId,
      orderId,
      amount: payout,
      reason: "EARNING",
      details: {
        leg,
        distanceKm: Math.round(resolved.distanceKm * 100) / 100,
        distanceSource: resolved.source,
        ratePerKm: riderPayoutPerKm,
      },
    });
  } catch (err) {
    // Non-fatal — do not block order flow
    console.error(
      JSON.stringify({
        level: "error",
        type: "RIDER_PAYOUT_ERROR",
        message: err instanceof Error ? err.message : String(err),
        orderId,
        riderId,
        leg,
        ts: new Date().toISOString(),
      }),
    );
  }
}
