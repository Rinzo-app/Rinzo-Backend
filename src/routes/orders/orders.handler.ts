import type { Response, NextFunction } from "express";
import { eq, and, inArray, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { shops } from "../../db/schema/shops.js";
import { services } from "../../db/schema/services.js";
import { orders, orderItems } from "../../db/schema/orders.js";
import { orderEvents } from "../../db/schema/order-events.js";
import { payments } from "../../db/schema/payments.js";
import { PLATFORM_FEE } from "../../lib/economics.js";
import { DELIVERY_RATE_PER_KM } from "../../config/delivery.js";
import { haversineDistance } from "../../lib/geo.js";
import type { AuthenticatedRequest } from "../../lib/types.js";
import {
  BadRequestError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
} from "../../lib/errors.js";
import type { OrderStatus, RejectionReason } from "../../lib/order-machine.js";
import { assertTransition } from "../../lib/order-machine.js";
import { createOrderSchema, rejectOrderSchema } from "./orders.schema.js";
import { tryAutoAssignPickup, tryAutoAssignDelivery } from "../../lib/auto-assign.js";

// ── Active statuses that count toward daily capacity ────
const ACTIVE_STATUSES: OrderStatus[] = [
  "PLACED",
  "SHOP_ACCEPTED",
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

    // ── 3. Capacity & auto-reject ────────────────────────
    const [{ count: activeCount }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(orders)
      .where(
        and(
          eq(orders.shopId, shop.id),
          inArray(orders.status, ACTIVE_STATUSES),
        ),
      );

    if (activeCount >= shop.dailyCapacity) {
      if (shop.autoRejectEnabled) {
        throw new ConflictError(
          "Shop has reached daily capacity",
          "ERR_SHOP_CAPACITY_FULL",
        );
      }
      // If auto-reject is off, capacity is soft — allow the order through
      // but the shop may reject manually later.
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
    let deliveryFee = 0;
    if (
      body.pickupLat != null &&
      body.pickupLng != null &&
      Number.isFinite(body.pickupLat) &&
      Number.isFinite(body.pickupLng)
    ) {
      const distanceM = haversineDistance(
        body.pickupLat,
        body.pickupLng,
        shop.latitude,
        shop.longitude,
      );
      const roundTripKm = (distanceM / 1000) * 2;
      deliveryFee = Math.round(roundTripKm * DELIVERY_RATE_PER_KM);
    }

    // ── 6. Insert order + order_items in a transaction ───
    const result = await db.transaction(async (tx) => {
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

    // ── 7. Respond ───────────────────────────────────────
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
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
    const orderId = req.params.id as string;
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
        .where(eq(orders.id, orderId))
        .returning();

      await tx.insert(orderEvents).values({
        orderId,
        fromStatus: order.status as OrderStatus,
        toStatus: "CANCELLED",
        actor: "CUSTOMER",
        actorId: customerId,
      });

      return row;
    });

    // ── 5. Respond ────────────────────────────────────────
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
    const orderId = req.params.id as string;
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
        .where(eq(orders.id, orderId))
        .returning();

      await tx.insert(orderEvents).values({
        orderId,
        fromStatus: order.status as OrderStatus,
        toStatus: "SHOP_ACCEPTED",
        actor: "SHOP_OWNER",
        actorId: ownerId,
      });

      return row;
    });

    // ── 5. Auto-assign a rider for pickup (fire-and-forget) ──
    tryAutoAssignPickup(orderId).catch(() => {});

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
    const orderId = req.params.id as string;
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
        .where(eq(orders.id, orderId))
        .returning();

      await tx.insert(orderEvents).values({
        orderId,
        fromStatus: order.status as OrderStatus,
        toStatus: "REJECTED_BY_SHOP",
        actor: "SHOP_OWNER",
        actorId: ownerId,
      });

      return row;
    });

    // ── 6. Respond ────────────────────────────────────────
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
    const orderId = req.params.id as string;
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
        .where(eq(orders.id, orderId))
        .returning();

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
    tryAutoAssignDelivery(orderId).catch(() => {});

    // ── 6. Respond ────────────────────────────────────────
    res.status(200).json(updated);
  } catch (err) {
    next(err);
  }
}
