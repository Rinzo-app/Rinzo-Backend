import type { Response, NextFunction } from "express";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { orders } from "../../db/schema/orders.js";
import { orderEvents } from "../../db/schema/order-events.js";
import { riders } from "../../db/schema/riders.js";
import { shops } from "../../db/schema/shops.js";
import { ledgerEntries } from "../../db/schema/ledger-entries.js";
import type { AuthenticatedRequest } from "../../lib/types.js";
import {
  NotFoundError,
  ForbiddenError,
  BadRequestError,
} from "../../lib/errors.js";
import type { OrderStatus } from "../../lib/order-machine.js";
import { assertTransition } from "../../lib/order-machine.js";
import { resolveRiderLegDistanceKm } from "../../lib/rider-distance.js";
import { RIDER_PAYOUT_PER_KM } from "../../config/rider-payout.js";
import { DELIVERY_RATE_PER_KM } from "../../config/delivery.js";

const availabilitySchema = z.object({
  isAvailable: z.boolean(),
});

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
// POST /api/rider/orders/:id/pickup
// PICKUP_ASSIGNED → PICKED_UP_FROM_CUSTOMER
// ─────────────────────────────────────────────────────────

export async function pickupOrder(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const orderId = req.params.id as string;
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
        .where(eq(orders.id, orderId))
        .returning();

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
    const orderId = req.params.id as string;
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
        .where(eq(orders.id, orderId))
        .returning();

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
    const orderId = req.params.id as string;
    const rider = await getRiderForUser(req.user.id);
    const order = await getOrderForRider(orderId, rider.id);

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
        })
        .where(eq(orders.id, orderId))
        .returning();

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

      return row;
    });

    res.status(200).json(updated);
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
      deliveryRatePerKm: DELIVERY_RATE_PER_KM,
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

    const payout = Math.round(resolved.distanceKm * RIDER_PAYOUT_PER_KM);
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
        ratePerKm: RIDER_PAYOUT_PER_KM,
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
