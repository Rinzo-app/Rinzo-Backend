import type { Response, NextFunction } from "express";
import { eq, and, desc, inArray, sql, getTableColumns } from "drizzle-orm";
import { db } from "../../db/client.js";
import { paginationSchema, paginate, paginatedResponse } from "../../lib/pagination.js";
import { orders, orderItems } from "../../db/schema/orders.js";
import { orderEvents } from "../../db/schema/order-events.js";
import { payments } from "../../db/schema/payments.js";
import { shops } from "../../db/schema/shops.js";
import { riders } from "../../db/schema/riders.js";
import { users } from "../../db/schema/users.js";
import { reviews } from "../../db/schema/reviews.js";
import type { AuthenticatedRequest } from "../../lib/types.js";
import {
  NotFoundError,
  ForbiddenError,
} from "../../lib/errors.js";
import { parseUUID } from "../../lib/validate-uuid.js";

// ─────────────────────────────────────────────────────────
// GET /api/orders/:id
//
// Any authenticated user may call this, but ownership is
// validated per role:
//   CUSTOMER  → order.customerId === user.id
//   SHOP_OWNER → order.shopId belongs to a shop they own
//   RIDER     → order.riderId matches their rider profile
//   ADMIN     → unrestricted
// ─────────────────────────────────────────────────────────

export async function getOrderById(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const orderId = parseUUID(req.params.id as string, "order ID");
    const { id: userId, role } = req.user;

    // ── 1. Fetch order ────────────────────────────────────
    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);

    if (!order) {
      throw new NotFoundError("Order not found", "ERR_ORDER_NOT_FOUND");
    }

    // ── 2. Role-based ownership check ─────────────────────
    if (role === "CUSTOMER") {
      if (order.customerId !== userId) {
        throw new ForbiddenError(
          "You can only view your own orders",
          "ERR_ORDER_NOT_OWNER",
        );
      }
    } else if (role === "SHOP_OWNER") {
      const [shop] = await db
        .select()
        .from(shops)
        .where(and(eq(shops.id, order.shopId), eq(shops.ownerId, userId)))
        .limit(1);
      if (!shop) {
        throw new ForbiddenError(
          "You do not own the shop this order belongs to",
          "ERR_NOT_SHOP_OWNER",
        );
      }
    } else if (role === "RIDER") {
      const [rider] = await db
        .select()
        .from(riders)
        .where(eq(riders.userId, userId))
        .limit(1);
      if (!rider || order.riderId !== rider.id) {
        throw new ForbiddenError(
          "You are not assigned to this order",
          "ERR_RIDER_NOT_ASSIGNED",
        );
      }
    }
    // ADMIN — no check needed

    // ── 3. Fetch order items ──────────────────────────────
    const items = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId));

    // ── 4. Fetch payment (1:1) ───────────────────────────────────
    const [payment] = await db
      .select()
      .from(payments)
      .where(eq(payments.orderId, orderId))
      .limit(1);

    // ── 5. Enrich with shop + customer names so apps don't
    //       fall back to "Laundry Shop" / "Customer" ─────────
    const [shop] = await db
      .select({
        name: shops.name,
        phone: shops.phone,
        address: shops.address,
        imageUrl: shops.imageUrl,
        latitude: shops.latitude,
        longitude: shops.longitude,
      })
      .from(shops)
      .where(eq(shops.id, order.shopId))
      .limit(1);

    const [customer] = await db
      .select({ name: users.name, phone: users.phone })
      .from(users)
      .where(eq(users.id, order.customerId))
      .limit(1);

    // ── Assigned rider's name + selfie (shown to the customer
    //    on active orders for trust/safety) ─────────────────
    let riderName: string | null = null;
    let riderPhotoUrl: string | null = null;
    let riderLat: number | null = null;
    let riderLng: number | null = null;
    let riderLocationUpdatedAt: Date | null = null;
    // Only share the rider's live location while they're actively
    // working this order (en route / carrying goods) — not before/after.
    const liveLegStatuses = [
      "PICKUP_ASSIGNED",
      "PICKED_UP_FROM_CUSTOMER",
      "DELIVERY_OFFERED",
      "OUT_FOR_DELIVERY",
    ];
    if (order.riderId) {
      const [riderRow] = await db
        .select({
          userId: riders.userId,
          selfieUrl: riders.selfieUrl,
          lastLat: riders.lastLat,
          lastLng: riders.lastLng,
          locationUpdatedAt: riders.locationUpdatedAt,
        })
        .from(riders)
        .where(eq(riders.id, order.riderId))
        .limit(1);
      if (riderRow) {
        riderPhotoUrl = riderRow.selfieUrl ?? null;
        if (liveLegStatuses.includes(order.status as string)) {
          riderLat = riderRow.lastLat ?? null;
          riderLng = riderRow.lastLng ?? null;
          riderLocationUpdatedAt = riderRow.locationUpdatedAt ?? null;
        }
        const [riderUser] = await db
          .select({ name: users.name })
          .from(users)
          .where(eq(users.id, riderRow.userId))
          .limit(1);
        // First name only, for privacy
        riderName = (riderUser?.name ?? "").split(" ")[0] || null;
      }
    }

    // Has this order already been reviewed?
    const [review] = await db
      .select({ rating: reviews.rating })
      .from(reviews)
      .where(eq(reviews.orderId, orderId))
      .limit(1);

    res.status(200).json({
      ...order,
      items,
      payment: payment ?? null,
      shopName: shop?.name ?? null,
      shopPhone: shop?.phone ?? null,
      shopAddress: shop?.address ?? null,
      shopImageUrl: shop?.imageUrl ?? null,
      shopLat: shop?.latitude ?? null,
      shopLng: shop?.longitude ?? null,
      customerName: customer?.name ?? null,
      customerPhone: customer?.phone ?? null,
      // Customer pickup/delivery coordinates (for rider navigation).
      // Aliased from the order row's pickup_lat/lng.
      customerLat: order.pickupLat ?? null,
      customerLng: order.pickupLng ?? null,
      riderName,
      riderPhotoUrl,
      riderLat,
      riderLng,
      riderLocationUpdatedAt,
      reviewRating: review?.rating ?? null,
    });
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────
// GET /api/orders/:id/events
//
// Same ownership rules as getOrderById.
// Returns the append-only event log sorted chronologically.
// ─────────────────────────────────────────────────────────

export async function getOrderEvents(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const orderId = parseUUID(req.params.id as string, "order ID");
    const { id: userId, role } = req.user;

    // ── 1. Fetch order (for ownership check) ──────────────
    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);

    if (!order) {
      throw new NotFoundError("Order not found", "ERR_ORDER_NOT_FOUND");
    }

    // ── 2. Role-based ownership check ─────────────────────
    if (role === "CUSTOMER") {
      if (order.customerId !== userId) {
        throw new ForbiddenError(
          "You can only view events for your own orders",
          "ERR_ORDER_NOT_OWNER",
        );
      }
    } else if (role === "SHOP_OWNER") {
      const [shop] = await db
        .select()
        .from(shops)
        .where(and(eq(shops.id, order.shopId), eq(shops.ownerId, userId)))
        .limit(1);
      if (!shop) {
        throw new ForbiddenError(
          "You do not own the shop this order belongs to",
          "ERR_NOT_SHOP_OWNER",
        );
      }
    } else if (role === "RIDER") {
      const [rider] = await db
        .select()
        .from(riders)
        .where(eq(riders.userId, userId))
        .limit(1);
      if (!rider || order.riderId !== rider.id) {
        throw new ForbiddenError(
          "You are not assigned to this order",
          "ERR_RIDER_NOT_ASSIGNED",
        );
      }
    }
    // ADMIN — no check needed

    // ── 3. Fetch events ───────────────────────────────────
    const events = await db
      .select()
      .from(orderEvents)
      .where(eq(orderEvents.orderId, orderId))
      .orderBy(orderEvents.createdAt);

    res.status(200).json(events);
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────
// GET /api/customer/orders
//
// CUSTOMER only — returns all orders for req.user.id
// ─────────────────────────────────────────────────────────

export async function listCustomerOrders(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { page, limit } = paginationSchema.parse(req.query);
    const { offset } = paginate(page, limit);
    const customerId = req.user.id;

    const [{ count: total }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(orders)
      .where(eq(orders.customerId, customerId));

    const result = await db
      .select({
        ...getTableColumns(orders),
        shopName: shops.name,
        shopImageUrl: shops.imageUrl,
      })
      .from(orders)
      .leftJoin(shops, eq(shops.id, orders.shopId))
      .where(eq(orders.customerId, customerId))
      .orderBy(desc(orders.createdAt))
      .limit(limit)
      .offset(offset);

    res.status(200).json(paginatedResponse(result, total, page, limit));
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────
// GET /api/shop/orders
//
// SHOP_OWNER only — returns all orders for shops they own.
// ─────────────────────────────────────────────────────────

export async function listShopOrders(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { page, limit } = paginationSchema.parse(req.query);
    const { offset } = paginate(page, limit);
    const ownerId = req.user.id;

    // Resolve all shops owned by this user
    const ownedShops = await db
      .select({ id: shops.id })
      .from(shops)
      .where(eq(shops.ownerId, ownerId));

    const shopIds = ownedShops.map((s) => s.id);

    if (shopIds.length === 0) {
      res.status(200).json(paginatedResponse([], 0, page, limit));
      return;
    }

    const [{ count: total }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(orders)
      .where(inArray(orders.shopId, shopIds));

    const result = await db
      .select()
      .from(orders)
      .where(inArray(orders.shopId, shopIds))
      .orderBy(desc(orders.createdAt))
      .limit(limit)
      .offset(offset);

    res.status(200).json(paginatedResponse(result, total, page, limit));
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────
// GET /api/rider/orders
//
// RIDER only — returns all orders assigned to this rider.
// ─────────────────────────────────────────────────────────

export async function listRiderOrders(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { page, limit } = paginationSchema.parse(req.query);
    const { offset } = paginate(page, limit);
    const userId = req.user.id;

    // Resolve rider profile
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

    const [{ count: total }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(orders)
      .where(eq(orders.riderId, rider.id));

    const result = await db
      .select()
      .from(orders)
      .where(eq(orders.riderId, rider.id))
      .orderBy(desc(orders.createdAt))
      .limit(limit)
      .offset(offset);

    res.status(200).json(paginatedResponse(result, total, page, limit));
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────
// GET /api/admin/orders
//
// ADMIN only — returns all orders (no ownership filter).
// ─────────────────────────────────────────────────────────

export async function listAllOrders(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { page, limit } = paginationSchema.parse(req.query);
    const { offset } = paginate(page, limit);

    const [{ count: total }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(orders);

    const result = await db
      .select()
      .from(orders)
      .orderBy(desc(orders.createdAt))
      .limit(limit)
      .offset(offset);

    res.status(200).json(paginatedResponse(result, total, page, limit));
  } catch (err) {
    next(err);
  }
}
