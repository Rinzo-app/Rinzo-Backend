import { and, eq, lt, isNull, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { orders } from "../db/schema/orders.js";
import { riders } from "../db/schema/riders.js";
import {
  tryAutoAssignPickup,
  tryAutoAssignDelivery,
  releasePickupOffer,
  releaseDeliveryOffer,
} from "./auto-assign.js";

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
