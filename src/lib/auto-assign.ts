import { and, eq, ne, asc, inArray, notExists, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { riders } from "../db/schema/riders.js";
import { orders } from "../db/schema/orders.js";
import { shops } from "../db/schema/shops.js";
import { orderEvents } from "../db/schema/order-events.js";
import type { OrderStatus } from "./order-machine.js";
import { assertTransition } from "./order-machine.js";
import { haversineDistance } from "./geo.js";
import { notifyUserAsync } from "./push.js";

// A rider is "busy" while physically carrying out a leg, or while
// holding a pending offer (one offer at a time per rider).
// (AT_SHOP / READY keep the order's riderId but the rider is free.)
const RIDER_BUSY_STATUSES: OrderStatus[] = [
  "PICKUP_OFFERED",
  "PICKUP_ASSIGNED",
  "PICKED_UP_FROM_CUSTOMER",
  "OUT_FOR_DELIVERY",
];

/** How long a rider has to accept a pickup offer. */
export const OFFER_WINDOW_MS = 60_000;

/** True when the rider has an active leg on some OTHER order. */
async function riderIsBusy(
  tx: Pick<typeof db, "select">,
  riderId: string,
  excludeOrderId: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        eq(orders.riderId, riderId),
        inArray(orders.status, RIDER_BUSY_STATUSES),
        ne(orders.id, excludeOrderId),
      ),
    )
    .limit(1);
  return !!row;
}

/** Structured error log for auto-assign failures (never thrown). */
function logAutoAssignError(stage: string, orderId: string, err: unknown): void {
  console.error(
    JSON.stringify({
      level: "error",
      type: "AUTO_ASSIGN_ERROR",
      stage,
      orderId,
      message: err instanceof Error ? err.message : String(err),
      ts: new Date().toISOString(),
    }),
  );
}

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
 * Find available riders ranked by proximity to `targetLat / targetLng`
 * (FIFO when no location data). Riders currently carrying out a leg
 * on another order are excluded — one active leg per rider.
 *
 * Returns up to `limit` candidates, best first.
 */
async function findAvailableRiders(
  targetLat?: number | null,
  targetLng?: number | null,
  limit = 3,
  excludeRiderIds: readonly string[] = [],
): Promise<Array<{ id: string; userId: string }>> {
  // ── Fetch ACTIVE + available riders with no busy leg ──
  const fetched = await db
    .select({
      id: riders.id,
      userId: riders.userId,
      lastLat: riders.lastLat,
      lastLng: riders.lastLng,
      locationUpdatedAt: riders.locationUpdatedAt,
    })
    .from(riders)
    .where(
      and(
        eq(riders.status, "ACTIVE"),
        eq(riders.isAvailable, true),
        notExists(
          db
            .select({ one: sql`1` })
            .from(orders)
            .where(
              and(
                eq(orders.riderId, riders.id),
                inArray(orders.status, RIDER_BUSY_STATUSES),
              ),
            ),
        ),
      ),
    )
    .orderBy(asc(riders.id)); // stable base order

  const excluded = new Set(excludeRiderIds);
  const available = fetched.filter((r) => !excluded.has(r.id));

  if (available.length === 0) return [];

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

      // Located riders first, locationless ones as backup candidates
      return [...withLocation, ...withoutLocation]
        .slice(0, limit)
        .map((r) => ({ id: r.id, userId: r.userId }));
    }

    // If no riders have location, fall through to FIFO below
  }

  // ── FIFO fallback (id-sorted) ─────────────────────────
  return available.slice(0, limit).map((r) => ({ id: r.id, userId: r.userId }));
}

/**
 * Offer the pickup to the best available rider after an order
 * transitions to SHOP_ACCEPTED (or returns there after a decline /
 * expiry). The rider must accept within OFFER_WINDOW_MS or the offer
 * cascades to the next candidate.
 *
 * Riders listed in the order's declinedRiderIds are skipped.
 *
 * Must be called *outside* the caller's transaction so we can
 * run our own atomic block.
 *
 * @returns The offered rider id, or null if none available.
 */
export async function tryAutoAssignPickup(
  orderId: string,
  { allowCycleReset = false }: { allowCycleReset?: boolean } = {},
): Promise<string | null> {
  // Re-read order to get latest committed state
  const [order] = await db
    .select({
      id: orders.id,
      riderId: orders.riderId,
      status: orders.status,
      shopId: orders.shopId,
      customerId: orders.customerId,
      declinedRiderIds: orders.declinedRiderIds,
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

  const declined = Array.isArray(order.declinedRiderIds)
    ? (order.declinedRiderIds as string[])
    : [];
  let candidates = await findAvailableRiders(shopLat, shopLng, 3, declined);

  // Cycle reset (sweeper only): when every available rider has declined,
  // re-open the rotation rather than stranding the order — better an
  // already-declined rider gets re-asked than nobody at all.
  if (candidates.length === 0 && allowCycleReset && declined.length > 0) {
    candidates = await findAvailableRiders(shopLat, shopLng, 3, []);
  }
  if (candidates.length === 0) return null;

  try {
    // Validate the SYSTEM transition
    assertTransition("SHOP_ACCEPTED", "PICKUP_OFFERED", "SYSTEM");

    // Try candidates in rank order — a concurrent assignment may have
    // grabbed the best rider between our query and the transaction.
    for (const rider of candidates) {
      const offered = await db.transaction(async (tx) => {
        // Lock the rider row to serialise competing assignments
        await tx.execute(
          sql`SELECT id FROM riders WHERE id = ${rider.id} FOR UPDATE`,
        );

        if (await riderIsBusy(tx, rider.id, orderId)) {
          return false; // raced — try the next candidate
        }

        // Re-check the order inside the transaction
        const [freshOrder] = await tx
          .select({ riderId: orders.riderId, status: orders.status })
          .from(orders)
          .where(eq(orders.id, orderId))
          .limit(1);

        if (!freshOrder || freshOrder.riderId || freshOrder.status !== "SHOP_ACCEPTED") {
          return true; // someone else handled the order — stop entirely
        }

        await tx
          .update(orders)
          .set({
            status: "PICKUP_OFFERED",
            riderId: rider.id,
            offerExpiresAt: new Date(Date.now() + OFFER_WINDOW_MS),
            updatedAt: new Date(),
          })
          .where(eq(orders.id, orderId));

        await tx.insert(orderEvents).values({
          orderId,
          fromStatus: "SHOP_ACCEPTED" as OrderStatus,
          toStatus: "PICKUP_OFFERED" as OrderStatus,
          actor: "SYSTEM",
          actorId: rider.userId,
        });

        return true;
      });

      if (offered) {
        notifyUserAsync(
          rider.userId,
          "New pickup offer 🛵",
          "A laundry pickup is waiting — accept it in the app within 60 seconds.",
          { type: "PICKUP_OFFERED", orderId },
        );
        return rider.id;
      }
    }

    return null; // all candidates raced away — order stays SHOP_ACCEPTED
  } catch (err) {
    // Non-fatal — order stays SHOP_ACCEPTED for manual assignment
    logAutoAssignError("PICKUP", orderId, err);
    return null;
  }
}

/**
 * Return an offered order to the pool (rider declined, or the offer
 * expired), recording the rider so they aren't re-offered, then
 * immediately try the next candidate.
 *
 * @param actor "RIDER" for an explicit decline, "SYSTEM" for expiry.
 * @returns true when the offer was released (regardless of re-offer).
 */
export async function releasePickupOffer(
  orderId: string,
  riderId: string,
  riderUserId: string,
  actor: "RIDER" | "SYSTEM",
): Promise<boolean> {
  try {
    assertTransition("PICKUP_OFFERED", "SHOP_ACCEPTED", actor);

    const released = await db.transaction(async (tx) => {
      const [fresh] = await tx
        .select({
          status: orders.status,
          riderId: orders.riderId,
          declinedRiderIds: orders.declinedRiderIds,
        })
        .from(orders)
        .where(eq(orders.id, orderId))
        .for("update")
        .limit(1);

      if (!fresh || fresh.status !== "PICKUP_OFFERED" || fresh.riderId !== riderId) {
        return false; // offer already resolved
      }

      const declined = Array.isArray(fresh.declinedRiderIds)
        ? (fresh.declinedRiderIds as string[])
        : [];
      // Only an explicit decline excludes the rider from re-offers.
      // A timed-out offer (actor SYSTEM) just returns to the pool —
      // missing a 60s window shouldn't blacklist the rider.
      if (actor === "RIDER" && !declined.includes(riderId)) {
        declined.push(riderId);
      }

      await tx
        .update(orders)
        .set({
          status: "SHOP_ACCEPTED",
          riderId: null,
          offerExpiresAt: null,
          declinedRiderIds: declined,
          updatedAt: new Date(),
        })
        .where(eq(orders.id, orderId));

      await tx.insert(orderEvents).values({
        orderId,
        fromStatus: "PICKUP_OFFERED" as OrderStatus,
        toStatus: "SHOP_ACCEPTED" as OrderStatus,
        actor,
        actorId: riderUserId,
      });

      return true;
    });

    if (released) {
      // Cascade to the next candidate (fire-and-forget semantics —
      // failures leave the order in the pool for the sweeper).
      await tryAutoAssignPickup(orderId);
    }

    return released;
  } catch (err) {
    logAutoAssignError("OFFER_RELEASE", orderId, err);
    return false;
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
      customerId: orders.customerId,
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

  // Resolve candidates: prefer the order's existing rider (they did
  // the pickup) when they're still active and not on another leg —
  // otherwise fall back to the ranked available pool.
  let candidates: Array<{ id: string; userId: string }> = [];

  if (order.riderId) {
    const [existingRider] = await db
      .select({ id: riders.id, userId: riders.userId, status: riders.status })
      .from(riders)
      .where(eq(riders.id, order.riderId))
      .limit(1);

    if (
      existingRider &&
      existingRider.status === "ACTIVE" &&
      !(await riderIsBusy(db, existingRider.id, orderId))
    ) {
      candidates = [{ id: existingRider.id, userId: existingRider.userId }];
    }
  }

  if (candidates.length === 0) {
    candidates = await findAvailableRiders(shopLat, shopLng);
  }
  if (candidates.length === 0) return null;

  try {
    assertTransition("READY", "OUT_FOR_DELIVERY", "SYSTEM");

    for (const rider of candidates) {
      const assigned = await db.transaction(async (tx) => {
        // Lock the rider row to serialise competing assignments
        await tx.execute(
          sql`SELECT id FROM riders WHERE id = ${rider.id} FOR UPDATE`,
        );

        if (await riderIsBusy(tx, rider.id, orderId)) {
          return false; // raced — try the next candidate
        }

        // Re-check the order inside the transaction
        const [freshOrder] = await tx
          .select({ status: orders.status })
          .from(orders)
          .where(eq(orders.id, orderId))
          .limit(1);

        if (!freshOrder || freshOrder.status !== "READY") {
          return true; // order moved on — stop entirely
        }

        await tx
          .update(orders)
          .set({
            status: "OUT_FOR_DELIVERY",
            riderId: rider.id,
            updatedAt: new Date(),
          })
          .where(eq(orders.id, orderId));

        await tx.insert(orderEvents).values({
          orderId,
          fromStatus: "READY" as OrderStatus,
          toStatus: "OUT_FOR_DELIVERY" as OrderStatus,
          actor: "SYSTEM",
          actorId: rider.userId,
        });

        return true;
      });

      if (assigned) {
        notifyUserAsync(
          rider.userId,
          "Delivery ready 🛵",
          "Laundry is ready at the shop — time to deliver it.",
          { type: "DELIVERY_ASSIGNED", orderId },
        );
        notifyUserAsync(
          order.customerId,
          "Out for delivery 🚚",
          "Your laundry is on its way back to you.",
          { type: "ORDER_OUT_FOR_DELIVERY", orderId },
        );
        return rider.id;
      }
    }

    return null; // all candidates raced away — order stays READY
  } catch (err) {
    // Non-fatal — order stays READY for manual dispatch
    logAutoAssignError("DELIVERY", orderId, err);
    return null;
  }
}
