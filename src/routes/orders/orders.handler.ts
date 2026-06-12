import type { Response, NextFunction } from "express";
import { z } from "zod";
import { eq, and, inArray, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { shops } from "../../db/schema/shops.js";
import { services } from "../../db/schema/services.js";
import { orders, orderItems } from "../../db/schema/orders.js";
import { orderEvents } from "../../db/schema/order-events.js";
import { payments } from "../../db/schema/payments.js";
import { PLATFORM_FEE } from "../../lib/economics.js";
import { computeDeliveryFee } from "../../lib/delivery-fee.js";
import { decideAdjustment } from "../../lib/weighing.js";
import { haversineDistance } from "../../lib/geo.js";
import type { AuthenticatedRequest } from "../../lib/types.js";
import {
  BadRequestError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
} from "../../lib/errors.js";
import { parseUUID } from "../../lib/validate-uuid.js";
import type { OrderStatus, RejectionReason } from "../../lib/order-machine.js";
import { assertTransition } from "../../lib/order-machine.js";
import { createOrderSchema, rejectOrderSchema } from "./orders.schema.js";
import { tryAutoAssignPickup, tryAutoAssignDelivery } from "../../lib/auto-assign.js";
import { notifyUserAsync } from "../../lib/push.js";

// ── Active statuses that count toward daily capacity ────
const ACTIVE_STATUSES: OrderStatus[] = [
  "PLACED",
  "SHOP_ACCEPTED",
  "PICKUP_OFFERED",
  "PICKUP_ASSIGNED",
  "PICKED_UP_FROM_CUSTOMER",
  "AT_SHOP",
];

// ─────────────────────────────────────────────────────────
// POST /api/orders
// ─────────────────────────────────────────────────────────

export async function createOrder(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // ── 1. Validate body ─────────────────────────────────
    const body = createOrderSchema.parse(req.body);
    const customerId = req.user.id;

    // ── 1b. Idempotency replay ───────────────────────────
    // Same key = same checkout attempt (double-tap, network retry).
    // Return the already-created order instead of duplicating it.
    if (body.idempotencyKey) {
      const existing = await findOrderByIdempotencyKey(
        body.idempotencyKey,
        customerId,
      );
      if (existing) {
        res.status(200).json(existing);
        return;
      }
    }

    // ── 2. Load & verify shop ────────────────────────────
    const [shop] = await db
      .select()
      .from(shops)
      .where(eq(shops.id, body.shopId))
      .limit(1);

    if (!shop) {
      throw new NotFoundError("Shop not found", "ERR_SHOP_NOT_FOUND");
    }
    if (shop.status !== "APPROVED") {
      throw new BadRequestError(
        "Shop is not approved to receive orders",
        "ERR_SHOP_NOT_APPROVED",
      );
    }
    if (!shop.isOpen) {
      throw new BadRequestError(
        "Shop is currently closed",
        "ERR_SHOP_CLOSED",
      );
    }

    // ── 4. Load & validate services ──────────────────────
    const requestedServiceIds = body.items.map((i) => i.serviceId);

    const shopServices = await db
      .select()
      .from(services)
      .where(
        and(
          eq(services.shopId, shop.id),
          inArray(services.id, requestedServiceIds),
          eq(services.isActive, true),
        ),
      );

    // Build a lookup: serviceId → service row
    const serviceMap = new Map(shopServices.map((s) => [s.id, s]));

    // Ensure every requested item resolves to a valid active service
    for (const item of body.items) {
      if (!serviceMap.has(item.serviceId)) {
        throw new BadRequestError(
          `Service '${item.serviceId}' is not available at this shop`,
          "ERR_SERVICE_UNAVAILABLE",
        );
      }
    }

    // ── 5. Compute total & build item rows ───────────────
    const itemRows = body.items.map((item) => {
      const svc = serviceMap.get(item.serviceId)!;
      return {
        serviceId: svc.id,
        serviceName: svc.name,
        price: svc.price,
        quantity: item.quantity,
        lineTotal: svc.price * item.quantity,
      };
    });

    const totalAmount = itemRows.reduce((sum, r) => sum + r.lineTotal, 0);

    // ── 5b. Compute delivery fee ─────────────────────────
    // Coordinates missing → fallback fee, never free delivery.
    const hasCoords =
      body.pickupLat != null &&
      body.pickupLng != null &&
      Number.isFinite(body.pickupLat) &&
      Number.isFinite(body.pickupLng);

    const deliveryFee = computeDeliveryFee(
      hasCoords
        ? haversineDistance(
            body.pickupLat!,
            body.pickupLng!,
            shop.latitude,
            shop.longitude,
          )
        : null,
    );

    // ── 6. Insert order + order_items in a transaction ───
    let result;
    try {
      result = await db.transaction(async (tx) => {
        // Lock the shop row so concurrent orders serialise on the
        // capacity check (count-then-insert was racy without it).
        await tx.execute(
          sql`SELECT id FROM shops WHERE id = ${shop.id} FOR UPDATE`,
        );

        // ── Capacity & auto-reject (inside the lock) ──
        const [{ count: activeCount }] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(orders)
          .where(
            and(
              eq(orders.shopId, shop.id),
              inArray(orders.status, ACTIVE_STATUSES),
            ),
          );

        if (activeCount >= shop.dailyCapacity && shop.autoRejectEnabled) {
          throw new ConflictError(
            "Shop has reached daily capacity",
            "ERR_SHOP_CAPACITY_FULL",
          );
        }
        // If auto-reject is off, capacity is soft — allow the order
        // through; the shop may reject manually later.

        const [order] = await tx
          .insert(orders)
          .values({
            customerId,
            shopId: shop.id,
            items: itemRows.map(({ serviceId, serviceName, price, quantity }) => ({
              serviceId,
              serviceName,
              price,
              quantity,
            })),
            totalAmount,
            platformFee: PLATFORM_FEE,
            deliveryFee,
            status: "PLACED",
            pickupAddress: body.pickupAddress,
            deliveryAddress: body.deliveryAddress,
            pickupLat: body.pickupLat ?? null,
            pickupLng: body.pickupLng ?? null,
            pickupDate: body.pickupDate ?? null,
            pickupSlot: body.pickupSlot ?? null,
            idempotencyKey: body.idempotencyKey ?? null,
          })
          .returning();

        const orderItemValues = itemRows.map((row) => ({
          orderId: order.id,
          serviceId: row.serviceId,
          serviceName: row.serviceName,
          price: row.price,
          quantity: row.quantity,
        }));

        const insertedItems = await tx
          .insert(orderItems)
          .values(orderItemValues)
          .returning();

        await tx.insert(orderEvents).values({
          orderId: order.id,
          fromStatus: null,
          toStatus: "PLACED",
          actor: "CUSTOMER",
          actorId: customerId,
        });

        // ── Auto-create payment record (COD / PENDING) ──
        // payment.amount = services total + platform fee + delivery fee
        const [payment] = await tx
          .insert(payments)
          .values({
            orderId: order.id,
            amount: order.totalAmount + order.platformFee + order.deliveryFee,
            method: "COD",
            status: "PENDING",
          })
          .returning();

        return { order, items: insertedItems, payment };
      });
    } catch (err) {
      // A concurrent duplicate submission lost the unique-index race —
      // return the order the winning request created.
      if (body.idempotencyKey && isUniqueViolation(err)) {
        const existing = await findOrderByIdempotencyKey(
          body.idempotencyKey,
          customerId,
        );
        if (existing) {
          res.status(200).json(existing);
          return;
        }
        throw new ConflictError(
          "Idempotency key is already in use",
          "ERR_IDEMPOTENCY_CONFLICT",
        );
      }
      throw err;
    }

    // ── 7. Notify shop owner + respond ───────────────────
    notifyUserAsync(
      shop.ownerId,
      "New order 🧺",
      `${itemRows.length} item${itemRows.length !== 1 ? "s" : ""} — ₹${((totalAmount + PLATFORM_FEE + deliveryFee) / 100).toFixed(0)}. Tap to accept.`,
      { type: "ORDER_PLACED", orderId: result.order.id },
    );

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

/** Walk an error chain looking for a Postgres unique violation (23505). */
function isUniqueViolation(err: unknown): boolean {
  let e: any = err;
  for (let i = 0; i < 5 && e; i++) {
    if (e.code === "23505") return true;
    e = e.cause;
  }
  return false;
}

/** Look up a previously created order by its idempotency key. */
async function findOrderByIdempotencyKey(key: string, customerId: string) {
  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.idempotencyKey, key))
    .limit(1);
  if (!order || order.customerId !== customerId) return null;

  const items = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, order.id));
  const [payment] = await db
    .select()
    .from(payments)
    .where(eq(payments.orderId, order.id))
    .limit(1);

  return { order, items, payment: payment ?? null };
}

// ─────────────────────────────────────────────────────────
// POST /api/orders/:id/cancel
// ─────────────────────────────────────────────────────────

export async function cancelOrder(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const orderId = parseUUID(req.params.id as string, "order ID");
    const customerId = req.user.id;

    // ── 1. Fetch order ────────────────────────────────────
    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);

    if (!order) {
      throw new NotFoundError("Order not found", "ERR_ORDER_NOT_FOUND");
    }

    // ── 2. Ownership check ────────────────────────────────
    if (order.customerId !== customerId) {
      throw new ForbiddenError(
        "You can only cancel your own orders",
        "ERR_ORDER_NOT_OWNER",
      );
    }

    // ── 3. Validate transition via state machine ──────────
    assertTransition(
      order.status as OrderStatus,
      "CANCELLED",
      "CUSTOMER",
    );

    // ── 4. Update order in transaction ────────────────────
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(orders)
        .set({
          status: "CANCELLED",
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
        toStatus: "CANCELLED",
        actor: "CUSTOMER",
        actorId: customerId,
      });

      return row;
    });

    // ── 5. Notify shop owner + respond ────────────────────
    const [cancelledShop] = await db
      .select({ ownerId: shops.ownerId })
      .from(shops)
      .where(eq(shops.id, order.shopId))
      .limit(1);
    if (cancelledShop) {
      notifyUserAsync(
        cancelledShop.ownerId,
        "Order cancelled",
        "A customer cancelled their order before acceptance.",
        { type: "ORDER_CANCELLED", orderId },
      );
    }

    res.status(200).json(updated);
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────
// POST /api/orders/:id/accept
// ─────────────────────────────────────────────────────────

export async function acceptOrder(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const orderId = parseUUID(req.params.id as string, "order ID");
    const ownerId = req.user.id;

    // ── 1. Fetch order ────────────────────────────────────
    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);

    if (!order) {
      throw new NotFoundError("Order not found", "ERR_ORDER_NOT_FOUND");
    }

    // ── 2. Shop ownership check ───────────────────────────
    const [shop] = await db
      .select()
      .from(shops)
      .where(
        and(eq(shops.id, order.shopId), eq(shops.ownerId, ownerId)),
      )
      .limit(1);

    if (!shop) {
      throw new ForbiddenError(
        "You do not own the shop this order belongs to",
        "ERR_NOT_SHOP_OWNER",
      );
    }

    // ── 3. Validate transition ────────────────────────────
    assertTransition(
      order.status as OrderStatus,
      "SHOP_ACCEPTED",
      "SHOP_OWNER",
    );

    // ── 4. Update order in transaction ────────────────────
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(orders)
        .set({
          status: "SHOP_ACCEPTED",
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
        toStatus: "SHOP_ACCEPTED",
        actor: "SHOP_OWNER",
        actorId: ownerId,
      });

      return row;
    });

    // ── 5. Notify customer ────────────────────────────────
    notifyUserAsync(
      order.customerId,
      "Order accepted ✅",
      `${shop.name} accepted your order. A rider will pick it up soon.`,
      { type: "ORDER_ACCEPTED", orderId },
    );

    // ── 6. Auto-assign a rider for pickup (fire-and-forget) ──
    tryAutoAssignPickup(orderId).catch((err) => {
      console.error(
        JSON.stringify({
          level: "error",
          type: "AUTO_ASSIGN_ERROR",
          stage: "PICKUP_DISPATCH",
          orderId,
          message: err instanceof Error ? err.message : String(err),
          ts: new Date().toISOString(),
        }),
      );
    });

    // ── 6. Respond ────────────────────────────────────────
    res.status(200).json(updated);
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────
// POST /api/orders/:id/reject
// ─────────────────────────────────────────────────────────

export async function rejectOrder(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const orderId = parseUUID(req.params.id as string, "order ID");
    const ownerId = req.user.id;

    // ── 1. Validate body ──────────────────────────────────
    const { rejectionReason } = rejectOrderSchema.parse(req.body);

    // ── 2. Fetch order ────────────────────────────────────
    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);

    if (!order) {
      throw new NotFoundError("Order not found", "ERR_ORDER_NOT_FOUND");
    }

    // ── 3. Shop ownership check ───────────────────────────
    const [shop] = await db
      .select()
      .from(shops)
      .where(
        and(eq(shops.id, order.shopId), eq(shops.ownerId, ownerId)),
      )
      .limit(1);

    if (!shop) {
      throw new ForbiddenError(
        "You do not own the shop this order belongs to",
        "ERR_NOT_SHOP_OWNER",
      );
    }

    // ── 4. Validate transition ────────────────────────────
    assertTransition(
      order.status as OrderStatus,
      "REJECTED_BY_SHOP",
      "SHOP_OWNER",
    );

    // ── 5. Update order in transaction ────────────────────
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(orders)
        .set({
          status: "REJECTED_BY_SHOP",
          rejectionReason: rejectionReason as RejectionReason,
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
        toStatus: "REJECTED_BY_SHOP",
        actor: "SHOP_OWNER",
        actorId: ownerId,
      });

      return row;
    });

    // ── 6. Notify customer + respond ──────────────────────
    notifyUserAsync(
      order.customerId,
      "Order declined",
      `${shop.name} couldn't take your order (${rejectionReason.replaceAll("_", " ").toLowerCase()}). Please try another shop.`,
      { type: "ORDER_REJECTED", orderId },
    );

    res.status(200).json(updated);
  } catch (err) {
    next(err);
  }
}
// ─────────────────────────────────────────────────────────
// POST /api/orders/quote
//
// Price preview for checkout — same math as createOrder but with
// no side effects, so the customer sees the full breakdown
// (items + delivery + platform fee) BEFORE placing the order.
// ─────────────────────────────────────────────────────────

const quoteSchema = z.object({
  shopId: z.string().uuid(),
  items: z
    .array(
      z.object({
        serviceId: z.string().uuid(),
        quantity: z.number().int().positive().max(100),
      }),
    )
    .min(1),
  pickupLat: z.number().min(-90).max(90).optional(),
  pickupLng: z.number().min(-180).max(180).optional(),
});

export async function quoteOrder(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = quoteSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError(
        parsed.error.issues.map((i) => i.message).join("; "),
      );
    }
    const body = parsed.data;

    const [shop] = await db
      .select()
      .from(shops)
      .where(eq(shops.id, body.shopId))
      .limit(1);
    if (!shop) {
      throw new NotFoundError("Shop not found", "ERR_SHOP_NOT_FOUND");
    }

    const shopServices = await db
      .select()
      .from(services)
      .where(
        and(
          eq(services.shopId, shop.id),
          inArray(services.id, body.items.map((i) => i.serviceId)),
          eq(services.isActive, true),
        ),
      );
    const serviceMap = new Map(shopServices.map((s) => [s.id, s]));
    for (const item of body.items) {
      if (!serviceMap.has(item.serviceId)) {
        throw new BadRequestError(
          `Service '${item.serviceId}' is not available at this shop`,
          "ERR_SERVICE_UNAVAILABLE",
        );
      }
    }

    const itemsTotal = body.items.reduce(
      (sum, item) => sum + serviceMap.get(item.serviceId)!.price * item.quantity,
      0,
    );

    const hasCoords =
      body.pickupLat != null &&
      body.pickupLng != null &&
      Number.isFinite(body.pickupLat) &&
      Number.isFinite(body.pickupLng);

    const deliveryFee = computeDeliveryFee(
      hasCoords
        ? haversineDistance(body.pickupLat!, body.pickupLng!, shop.latitude, shop.longitude)
        : null,
    );

    res.status(200).json({
      itemsTotal,
      deliveryFee,
      platformFee: PLATFORM_FEE,
      total: itemsTotal + deliveryFee + PLATFORM_FEE,
    });
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────
// POST /api/orders/:id/weigh
//
// The shop weighs the laundry once it arrives (AT_SHOP) and submits
// actual quantities. The price recalculates:
//   - decrease / increase ≤ AUTO_APPROVE_INCREASE_PCT → applies now
//   - larger increase → PENDING until the customer approves
// Re-weighing is allowed while the order is still AT_SHOP; the
// approval threshold always compares against the customer's
// original checkout estimate.
// ─────────────────────────────────────────────────────────

const weighSchema = z.object({
  items: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        actualQuantity: z.number().positive().max(1000),
      }),
    )
    .min(1),
});

export async function weighOrder(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const orderId = parseUUID(req.params.id as string, "order ID");
    const ownerId = req.user.id;

    const parsed = weighSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError(
        parsed.error.issues.map((i) => i.message).join("; "),
      );
    }

    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    if (!order) {
      throw new NotFoundError("Order not found", "ERR_ORDER_NOT_FOUND");
    }

    const [shop] = await db
      .select()
      .from(shops)
      .where(and(eq(shops.id, order.shopId), eq(shops.ownerId, ownerId)))
      .limit(1);
    if (!shop) {
      throw new ForbiddenError(
        "You do not own the shop this order belongs to",
        "ERR_NOT_SHOP_OWNER",
      );
    }

    if (order.status !== "AT_SHOP") {
      throw new ConflictError(
        "Weighing is only possible while the laundry is at the shop",
        "ERR_NOT_AT_SHOP",
      );
    }

    const items = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId));

    const byId = new Map(items.map((i) => [i.id, i]));
    for (const w of parsed.data.items) {
      if (!byId.has(w.itemId)) {
        throw new BadRequestError(`Item ${w.itemId} does not belong to this order`);
      }
    }

    // New total: weighed items use actual qty, the rest keep estimates
    const weighedById = new Map(parsed.data.items.map((w) => [w.itemId, w.actualQuantity]));
    let newTotal = 0;
    for (const item of items) {
      const actual = weighedById.get(item.id);
      const prevActual = item.actualQuantity;
      const qty = actual ?? prevActual ?? item.quantity;
      newTotal += Math.round(item.price * qty);
    }

    const baseline = order.originalTotalAmount ?? order.totalAmount;
    const decision = decideAdjustment(baseline, newTotal);

    const updated = await db.transaction(async (tx) => {
      for (const w of parsed.data.items) {
        await tx
          .update(orderItems)
          .set({ actualQuantity: w.actualQuantity })
          .where(eq(orderItems.id, w.itemId));
      }

      if (decision === "APPLY") {
        const [row] = await tx
          .update(orders)
          .set({
            totalAmount: newTotal,
            originalTotalAmount: baseline,
            proposedTotalAmount: null,
            adjustmentStatus: "APPLIED",
            updatedAt: new Date(),
          })
          .where(eq(orders.id, orderId))
          .returning();

        await tx
          .update(payments)
          .set({ amount: newTotal + order.platformFee + order.deliveryFee })
          .where(and(eq(payments.orderId, orderId), eq(payments.status, "PENDING")));

        return row;
      }

      const [row] = await tx
        .update(orders)
        .set({
          originalTotalAmount: baseline,
          proposedTotalAmount: newTotal,
          adjustmentStatus: "PENDING",
          updatedAt: new Date(),
        })
        .where(eq(orders.id, orderId))
        .returning();
      return row;
    });

    if (decision === "APPLY") {
      if (newTotal !== baseline) {
        notifyUserAsync(
          order.customerId,
          "Final price updated ⚖️",
          `Your laundry weighed in at ₹${(newTotal / 100).toFixed(0)} (was ₹${(baseline / 100).toFixed(0)} estimated).`,
          { type: "PRICE_ADJUSTED", orderId },
        );
      }
    } else {
      notifyUserAsync(
        order.customerId,
        "Price approval needed ⚖️",
        `After weighing, your order comes to ₹${(newTotal / 100).toFixed(0)} (estimated ₹${(baseline / 100).toFixed(0)}). Open the app to approve.`,
        { type: "PRICE_APPROVAL_NEEDED", orderId },
      );
    }

    res.status(200).json(updated);
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────
// POST /api/orders/:id/approve-adjustment
// Customer approves a weighed price that exceeded the
// auto-approval threshold.
// ─────────────────────────────────────────────────────────

export async function approveAdjustment(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const orderId = parseUUID(req.params.id as string, "order ID");

    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    if (!order) {
      throw new NotFoundError("Order not found", "ERR_ORDER_NOT_FOUND");
    }
    if (order.customerId !== req.user.id) {
      throw new ForbiddenError("This is not your order", "ERR_NOT_YOUR_ORDER");
    }
    if (order.adjustmentStatus !== "PENDING" || order.proposedTotalAmount == null) {
      throw new ConflictError(
        "There is no price adjustment waiting for approval",
        "ERR_NO_PENDING_ADJUSTMENT",
      );
    }

    const newTotal = order.proposedTotalAmount;

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(orders)
        .set({
          totalAmount: newTotal,
          proposedTotalAmount: null,
          adjustmentStatus: "APPLIED",
          updatedAt: new Date(),
        })
        .where(and(eq(orders.id, orderId), eq(orders.adjustmentStatus, "PENDING")))
        .returning();

      if (!row) {
        throw new ConflictError(
          "Adjustment changed concurrently — please retry",
          "ERR_ORDER_RACE",
        );
      }

      await tx
        .update(payments)
        .set({ amount: newTotal + order.platformFee + order.deliveryFee })
        .where(and(eq(payments.orderId, orderId), eq(payments.status, "PENDING")));

      return row;
    });

    // Tell the shop they can proceed
    const [shop] = await db
      .select({ ownerId: shops.ownerId })
      .from(shops)
      .where(eq(shops.id, order.shopId))
      .limit(1);
    if (shop) {
      notifyUserAsync(
        shop.ownerId,
        "Price approved ✅",
        "The customer approved the weighed price — you can continue with the order.",
        { type: "PRICE_APPROVED", orderId },
      );
    }

    res.status(200).json(updated);
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────
// POST /api/orders/:id/ready
// AT_SHOP → READY
// ─────────────────────────────────────────────────────────

export async function markReady(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const orderId = parseUUID(req.params.id as string, "order ID");
    const ownerId = req.user.id;

    // ── 1. Fetch order ────────────────────────────────────
    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);

    if (!order) {
      throw new NotFoundError("Order not found", "ERR_ORDER_NOT_FOUND");
    }

    // ── 2. Shop ownership check ───────────────────────────
    const [shop] = await db
      .select()
      .from(shops)
      .where(
        and(eq(shops.id, order.shopId), eq(shops.ownerId, ownerId)),
      )
      .limit(1);

    if (!shop) {
      throw new ForbiddenError(
        "You do not own the shop this order belongs to",
        "ERR_NOT_SHOP_OWNER",
      );
    }

    // ── 3. Price adjustment gate ──────────────────────────
    // A weighed price above the auto-approve threshold must be
    // accepted by the customer before the order can progress.
    if (order.adjustmentStatus === "PENDING") {
      throw new ConflictError(
        "Waiting for the customer to approve the updated price",
        "ERR_ADJUSTMENT_PENDING",
      );
    }

    // ── 4. Validate transition ────────────────────────────
    assertTransition(
      order.status as OrderStatus,
      "READY",
      "SHOP_OWNER",
    );

    // ── 4. Update order in transaction ────────────────────
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(orders)
        .set({
          status: "READY",
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
        toStatus: "READY",
        actor: "SHOP_OWNER",
        actorId: ownerId,
      });

      return row;
    });

    // ── 5. Auto-assign rider for delivery (fire-and-forget) ──
    tryAutoAssignDelivery(orderId).catch((err) => {
      console.error(
        JSON.stringify({
          level: "error",
          type: "AUTO_ASSIGN_ERROR",
          stage: "DELIVERY_DISPATCH",
          orderId,
          message: err instanceof Error ? err.message : String(err),
          ts: new Date().toISOString(),
        }),
      );
    });

    // ── 6. Respond ────────────────────────────────────────
    res.status(200).json(updated);
  } catch (err) {
    next(err);
  }
}
