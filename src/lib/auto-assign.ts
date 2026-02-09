import { and, eq, asc } from "drizzle-orm";
import { db } from "../db/client.js";
import { riders } from "../db/schema/riders.js";
import { orders } from "../db/schema/orders.js";
import { shops } from "../db/schema/shops.js";
import { orderEvents } from "../db/schema/order-events.js";
import type { OrderStatus } from "./order-machine.js";
import { assertTransition } from "./order-machine.js";
import { haversineDistance } from "./geo.js";

// ─────────────────────────────────────────────────────────
// AUTO-ASSIGN RIDER  (geo-aware with FIFO fallback)
//
// 1. Fetch all ACTIVE + available riders.
// 2. If a target coordinate is provided AND at least one
//    rider has a known location, sort by Haversine distance
//    ASC → locationUpdatedAt DESC → id ASC.
// 3. Otherwise fall back to FIFO (id ASC).
//
// Returns the closest rider, or null.
// ─────────────────────────────────────────────────────────

/**
 * Find the nearest available rider to `targetLat / targetLng`.
 * Falls back to FIFO when no riders have location data or when
 * no target coordinate is provided.
 */
async function findAvailableRider(
  targetLat?: number | null,
  targetLng?: number | null,
): Promise<{ id: string; userId: string } | null> {
  // ── Always fetch all available ACTIVE riders ──────────
  const available = await db
    .select({
      id: riders.id,
      userId: riders.userId,
      lastLat: riders.lastLat,
      lastLng: riders.lastLng,
      locationUpdatedAt: riders.locationUpdatedAt,
    })
    .from(riders)
    .where(and(eq(riders.status, "ACTIVE"), eq(riders.isAvailable, true)))
    .orderBy(asc(riders.id)); // stable base order

  if (available.length === 0) return null;

  // ── If we have a target coordinate, rank by distance ──
  const hasTarget =
    targetLat != null &&
    targetLng != null &&
    Number.isFinite(targetLat) &&
    Number.isFinite(targetLng);

  if (hasTarget) {
    type Scored = (typeof available)[number] & { distance: number };

    const withLocation: Scored[] = [];
    const withoutLocation: (typeof available)[number][] = [];

    for (const r of available) {
      if (r.lastLat != null && r.lastLng != null) {
        withLocation.push({
          ...r,
          distance: haversineDistance(r.lastLat, r.lastLng, targetLat!, targetLng!),
        });
      } else {
        withoutLocation.push(r);
      }
    }

    if (withLocation.length > 0) {
      withLocation.sort((a, b) => {
        // 1️⃣ distance ASC
        if (a.distance !== b.distance) return a.distance - b.distance;
        // 2️⃣ most-recent location update first
        const aTime = a.locationUpdatedAt?.getTime() ?? 0;
        const bTime = b.locationUpdatedAt?.getTime() ?? 0;
        if (aTime !== bTime) return bTime - aTime;
        // 3️⃣ stable FIFO by id
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      });

      return { id: withLocation[0].id, userId: withLocation[0].userId };
    }

    // If no riders have location, fall through to FIFO below
  }

  // ── FIFO fallback (first in the id-sorted list) ──────
  return { id: available[0].id, userId: available[0].userId };
}

/**
 * Try to auto-assign a rider for **pickup** after an order
 * transitions to SHOP_ACCEPTED.
 *
 * Must be called *outside* the caller's transaction so we can
 * run our own atomic block.  The order must already be in
 * SHOP_ACCEPTED status (committed).
 *
 * @returns The assigned rider id, or null if none available.
 */
export async function tryAutoAssignPickup(
  orderId: string,
): Promise<string | null> {
  // Re-read order to get latest committed state
  const [order] = await db
    .select({
      id: orders.id,
      riderId: orders.riderId,
      status: orders.status,
      shopId: orders.shopId,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!order) return null;

  // Don't override an existing rider assignment
  if (order.riderId) return null;

  // Only act when order is in SHOP_ACCEPTED
  if (order.status !== "SHOP_ACCEPTED") return null;

  // Resolve shop coordinates for geo-ranking
  let shopLat: number | null = null;
  let shopLng: number | null = null;

  const [shop] = await db
    .select({ latitude: shops.latitude, longitude: shops.longitude })
    .from(shops)
    .where(eq(shops.id, order.shopId))
    .limit(1);

  if (shop) {
    shopLat = shop.latitude;
    shopLng = shop.longitude;
  }

  const rider = await findAvailableRider(shopLat, shopLng);
  if (!rider) return null;

  try {
    // Validate the SYSTEM transition
    assertTransition("SHOP_ACCEPTED", "PICKUP_ASSIGNED", "SYSTEM");

    await db.transaction(async (tx) => {
      // Re-check inside the transaction to prevent races
      const [freshOrder] = await tx
        .select({ riderId: orders.riderId, status: orders.status })
        .from(orders)
        .where(eq(orders.id, orderId))
        .limit(1);

      if (!freshOrder || freshOrder.riderId || freshOrder.status !== "SHOP_ACCEPTED") {
        return; // bail — someone else already assigned or status changed
      }

      await tx
        .update(orders)
        .set({
          status: "PICKUP_ASSIGNED",
          riderId: rider.id,
          updatedAt: new Date(),
        })
        .where(eq(orders.id, orderId));

      await tx.insert(orderEvents).values({
        orderId,
        fromStatus: "SHOP_ACCEPTED" as OrderStatus,
        toStatus: "PICKUP_ASSIGNED" as OrderStatus,
        actor: "SYSTEM",
        actorId: rider.userId,
      });
    });

    return rider.id;
  } catch {
    // Non-fatal — order stays SHOP_ACCEPTED for manual assignment
    return null;
  }
}

/**
 * Try to auto-assign a rider for **delivery** after an order
 * transitions to READY.
 *
 * If riderId is already set, reuse that rider and progress
 * directly to OUT_FOR_DELIVERY.
 * If riderId is null, find an available rider first.
 *
 * @returns The rider id if delivery was dispatched, or null.
 */
export async function tryAutoAssignDelivery(
  orderId: string,
): Promise<string | null> {
  // Re-read order to get latest committed state
  const [order] = await db
    .select({
      id: orders.id,
      riderId: orders.riderId,
      status: orders.status,
      shopId: orders.shopId,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!order) return null;

  // Only act when order is in READY
  if (order.status !== "READY") return null;

  // Resolve shop coordinates for geo-ranking
  let shopLat: number | null = null;
  let shopLng: number | null = null;

  const [shop] = await db
    .select({ latitude: shops.latitude, longitude: shops.longitude })
    .from(shops)
    .where(eq(shops.id, order.shopId))
    .limit(1);

  if (shop) {
    shopLat = shop.latitude;
    shopLng = shop.longitude;
  }

  // Resolve the rider: reuse existing or find a new one
  let riderId = order.riderId;
  let riderUserId: string | null = null;

  if (riderId) {
    // Look up the rider's userId for the event actorId
    const [existingRider] = await db
      .select({ userId: riders.userId })
      .from(riders)
      .where(eq(riders.id, riderId))
      .limit(1);

    riderUserId = existingRider?.userId ?? null;
  } else {
    const available = await findAvailableRider(shopLat, shopLng);
    if (!available) return null;
    riderId = available.id;
    riderUserId = available.userId;
  }

  if (!riderId || !riderUserId) return null;

  try {
    assertTransition("READY", "OUT_FOR_DELIVERY", "SYSTEM");

    await db.transaction(async (tx) => {
      // Re-check inside the transaction
      const [freshOrder] = await tx
        .select({ riderId: orders.riderId, status: orders.status })
        .from(orders)
        .where(eq(orders.id, orderId))
        .limit(1);

      if (!freshOrder || freshOrder.status !== "READY") {
        return; // bail
      }

      await tx
        .update(orders)
        .set({
          status: "OUT_FOR_DELIVERY",
          riderId,
          updatedAt: new Date(),
        })
        .where(eq(orders.id, orderId));

      await tx.insert(orderEvents).values({
        orderId,
        fromStatus: "READY" as OrderStatus,
        toStatus: "OUT_FOR_DELIVERY" as OrderStatus,
        actor: "SYSTEM",
        actorId: riderUserId!,
      });
    });

    return riderId;
  } catch {
    // Non-fatal — order stays READY for manual dispatch
    return null;
  }
}
