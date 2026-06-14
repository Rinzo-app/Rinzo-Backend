import { and, eq, lt, isNull, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { orders } from "../db/schema/orders.js";
import { orderEvents } from "../db/schema/order-events.js";
import { riders } from "../db/schema/riders.js";
import {
  tryAutoAssignPickup,
  tryAutoAssignDelivery,
  releasePickupOffer,
  releaseDeliveryOffer,
  releaseAssignedPickup,
} from "./auto-assign.js";
import { getPricing } from "./pricing-config.js";
import { notifyUserAsync } from "./push.js";

// ─────────────────────────────────────────────────────────
// OFFER SWEEPER
//
// Two responsibilities, run every SWEEP_INTERVAL_MS:
//   1. Expire pickup offers whose window has passed — treated as a
//      decline (rider excluded) and cascaded to the next candidate.
//   2. Retry pool orders (SHOP_ACCEPTED, no rider) — covers riders
//      coming online after the initial offer round found nobody.
//
// Single-instance deployment (Render) makes an in-process interval
// sufficient; every mutation is guarded by the same transactional
// checks as the request path, so duplicated sweepers are safe too.
// ─────────────────────────────────────────────────────────

const SWEEP_INTERVAL_MS = 15_000;

/** Pool orders younger than this are left alone — the accept-time
 *  offer round is likely still in flight. */
const POOL_RETRY_AFTER_MS = 30_000;

const BATCH_LIMIT = 20;

let timer: NodeJS.Timeout | null = null;
let running = false;

async function sweepOnce(): Promise<void> {
  // ── 1. Expired offers → release + cascade ─────────────
  const expired = await db
    .select({
      orderId: orders.id,
      riderId: orders.riderId,
      riderUserId: riders.userId,
      status: orders.status,
    })
    .from(orders)
    .innerJoin(riders, eq(riders.id, orders.riderId))
    .where(
      and(
        inArray(orders.status, ["PICKUP_OFFERED", "DELIVERY_OFFERED"]),
        lt(orders.offerExpiresAt, new Date()),
      ),
    )
    .limit(BATCH_LIMIT);

  for (const o of expired) {
    if (!o.riderId) continue;
    if (o.status === "DELIVERY_OFFERED") {
      await releaseDeliveryOffer(o.orderId, o.riderId, o.riderUserId, "SYSTEM");
    } else {
      await releasePickupOffer(o.orderId, o.riderId, o.riderUserId, "SYSTEM");
    }
  }

  // ── 2. Pool retry — pickups waiting for a rider ───────
  const stalePickup = await db
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        eq(orders.status, "SHOP_ACCEPTED"),
        isNull(orders.riderId),
        lt(orders.updatedAt, new Date(Date.now() - POOL_RETRY_AFTER_MS)),
      ),
    )
    .limit(BATCH_LIMIT);

  for (const o of stalePickup) {
    await tryAutoAssignPickup(o.id, { allowCycleReset: true });
  }

  // ── 3. Pool retry — deliveries waiting for a rider ────
  const staleDelivery = await db
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        eq(orders.status, "READY"),
        isNull(orders.riderId),
        lt(orders.updatedAt, new Date(Date.now() - POOL_RETRY_AFTER_MS)),
      ),
    )
    .limit(BATCH_LIMIT);

  for (const o of staleDelivery) {
    await tryAutoAssignDelivery(o.id, { allowCycleReset: true });
  }

  // ── 4. Auto-cancel stuck orders (operator-configurable timeouts) ──
  const { placedTimeoutMin, noRiderTimeoutMin, pickupSlaMin, deliverySlaMin } =
    getPricing();

  // (a) Shop never accepted — PLACED older than the accept timeout.
  const placedCutoff = new Date(Date.now() - placedTimeoutMin * 60_000);
  const cancelledPlaced = await db
    .update(orders)
    .set({ status: "CANCELLED", updatedAt: new Date() })
    .where(and(eq(orders.status, "PLACED"), lt(orders.createdAt, placedCutoff)))
    .returning({ id: orders.id, customerId: orders.customerId });

  for (const o of cancelledPlaced) {
    await db.insert(orderEvents).values({
      orderId: o.id,
      fromStatus: "PLACED",
      toStatus: "CANCELLED",
      actor: "SYSTEM",
      actorId: o.customerId,
    });
    notifyUserAsync(
      o.customerId,
      "Order cancelled",
      "The shop didn't confirm your order in time, so it was cancelled. No charge — please try another shop.",
      { type: "ORDER_CANCELLED", orderId: o.id },
    );
  }

  // (b) No rider found — SHOP_ACCEPTED with no rider past the timeout.
  const noRiderCutoff = new Date(Date.now() - noRiderTimeoutMin * 60_000);
  const cancelledNoRider = await db
    .update(orders)
    .set({ status: "CANCELLED", updatedAt: new Date() })
    .where(
      and(
        eq(orders.status, "SHOP_ACCEPTED"),
        isNull(orders.riderId),
        lt(orders.updatedAt, noRiderCutoff),
      ),
    )
    .returning({ id: orders.id, customerId: orders.customerId });

  for (const o of cancelledNoRider) {
    await db.insert(orderEvents).values({
      orderId: o.id,
      fromStatus: "SHOP_ACCEPTED",
      toStatus: "CANCELLED",
      actor: "SYSTEM",
      actorId: o.customerId,
    });
    notifyUserAsync(
      o.customerId,
      "Order cancelled",
      "We couldn't find a rider for your order, so it was cancelled. No charge — sorry for the inconvenience.",
      { type: "ORDER_CANCELLED", orderId: o.id },
    );
  }

  // ── 5. Pickup SLA — rider accepted but never collected ────
  // Auto-unassign and re-offer (goods still with the customer).
  const pickupSlaCutoff = new Date(Date.now() - pickupSlaMin * 60_000);
  const idlePickups = await db
    .select({
      orderId: orders.id,
      riderId: orders.riderId,
      riderUserId: riders.userId,
    })
    .from(orders)
    .innerJoin(riders, eq(riders.id, orders.riderId))
    .where(
      and(
        eq(orders.status, "PICKUP_ASSIGNED"),
        lt(orders.updatedAt, pickupSlaCutoff),
        // A rider who reported a delay keeps the order — it's flagged for
        // admin instead of being auto-reassigned.
        isNull(orders.delayReportedAt),
      ),
    )
    .limit(BATCH_LIMIT);

  for (const o of idlePickups) {
    if (!o.riderId) continue;
    await releaseAssignedPickup(o.orderId, o.riderId, o.riderUserId);
  }

  // ── 6. Delivery SLA — rider carrying goods too long ───────
  // Can't safely reassign (goods are in the rider's hands), so flag the
  // order for admin follow-up. Marked once via sla_breached_at.
  const deliverySlaCutoff = new Date(Date.now() - deliverySlaMin * 60_000);
  const flagged = await db
    .update(orders)
    .set({ slaBreachedAt: new Date() })
    .where(
      and(
        inArray(orders.status, ["PICKED_UP_FROM_CUSTOMER", "OUT_FOR_DELIVERY"]),
        lt(orders.updatedAt, deliverySlaCutoff),
        isNull(orders.slaBreachedAt),
      ),
    )
    .returning({ id: orders.id, status: orders.status, riderId: orders.riderId });

  for (const o of flagged) {
    console.warn(
      JSON.stringify({
        level: "warn",
        type: "DELIVERY_SLA_BREACH",
        message: "Rider carrying goods exceeded the delivery SLA — flagged for admin",
        orderId: o.id,
        status: o.status,
        riderId: o.riderId,
        ts: new Date().toISOString(),
      }),
    );
  }
}

export function startOfferSweeper(): void {
  if (timer) return;
  timer = setInterval(() => {
    if (running) return; // skip overlapping runs
    running = true;
    sweepOnce()
      .catch((err) => {
        console.error(
          JSON.stringify({
            level: "error",
            type: "OFFER_SWEEPER_ERROR",
            message: err instanceof Error ? err.message : String(err),
            ts: new Date().toISOString(),
          }),
        );
      })
      .finally(() => {
        running = false;
      });
  }, SWEEP_INTERVAL_MS);
  // Don't keep the process alive just for the sweeper
  timer.unref?.();
}

export function stopOfferSweeper(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
