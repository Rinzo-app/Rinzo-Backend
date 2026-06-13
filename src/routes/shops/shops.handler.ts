import type { Response, NextFunction } from "express";
import { eq, and, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { paginationSchema, paginate, paginatedResponse } from "../../lib/pagination.js";
import { shops } from "../../db/schema/shops.js";
import { services } from "../../db/schema/services.js";
import { reviews } from "../../db/schema/reviews.js";
import { users } from "../../db/schema/users.js";
import { desc } from "drizzle-orm";
import type { AuthenticatedRequest } from "../../lib/types.js";
import { NotFoundError } from "../../lib/errors.js";
import { parseUUID } from "../../lib/validate-uuid.js";

// ─────────────────────────────────────────────────────────
// GET /api/shops
//
// Returns all shops with status APPROVED (visible to
// customers for browsing).  Column-picked — no internal
// fields like ownerId or autoRejectEnabled.
// ─────────────────────────────────────────────────────────

export async function listShops(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { page, limit } = paginationSchema.parse(req.query);
    const { offset } = paginate(page, limit);

    const [{ count: total }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(shops)
      .where(eq(shops.status, "APPROVED"));

    const rows = await db
      .select({
        id: shops.id,
        name: shops.name,
        phone: shops.phone,
        address: shops.address,
        latitude: shops.latitude,
        longitude: shops.longitude,
        isOpen: shops.isOpen,
        rating: shops.rating,
        totalRatings: shops.totalRatings,
        openTime: shops.openTime,
        closeTime: shops.closeTime,
        deliveryFee: shops.deliveryFee,
        minOrder: shops.minOrder,
        serviceRadiusKm: shops.serviceRadiusKm,
      })
      .from(shops)
      .where(eq(shops.status, "APPROVED"))
      .limit(limit)
      .offset(offset);

    // Include lat/lng aliases for Customer app compatibility
    const mapped = rows.map((shop) => ({
      ...shop,
      lat: shop.latitude,
      lng: shop.longitude,
    }));

    res.status(200).json(paginatedResponse(mapped, total, page, limit));
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────
// GET /api/shops/:id
//
// Returns a single shop's public detail.  Validates that
// :id is a well-formed UUID (400 if not) and that the shop
// exists (404 if not).
// ─────────────────────────────────────────────────────────

export async function getShopDetail(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const shopId = parseUUID(req.params.id as string, "shop ID");

    const [shop] = await db
      .select({
        id: shops.id,
        name: shops.name,
        phone: shops.phone,
        address: shops.address,
        latitude: shops.latitude,
        longitude: shops.longitude,
        isOpen: shops.isOpen,
        dailyCapacity: shops.dailyCapacity,
        rating: shops.rating,
        totalRatings: shops.totalRatings,
        openTime: shops.openTime,
        closeTime: shops.closeTime,
        deliveryFee: shops.deliveryFee,
        minOrder: shops.minOrder,
        serviceRadiusKm: shops.serviceRadiusKm,
      })
      .from(shops)
      .where(eq(shops.id, shopId))
      .limit(1);

    if (!shop) {
      throw new NotFoundError("Shop not found", "ERR_SHOP_NOT_FOUND");
    }

    // Include lat/lng aliases for Customer app compatibility
    res.status(200).json({
      ...shop,
      lat: shop.latitude,
      lng: shop.longitude,
    });
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────
// GET /api/shops/:id/services
//
// Returns all active services offered by a shop.
// Validates :id UUID and verifies the shop exists.
// ─────────────────────────────────────────────────────────

export async function getShopServices(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const shopId = parseUUID(req.params.id as string, "shop ID");

    // Verify the shop exists
    const [shop] = await db
      .select({ id: shops.id })
      .from(shops)
      .where(eq(shops.id, shopId))
      .limit(1);

    if (!shop) {
      throw new NotFoundError("Shop not found", "ERR_SHOP_NOT_FOUND");
    }

    const rows = await db
      .select({
        id: services.id,
        name: services.name,
        price: services.price,
        pricingType: services.pricingType,
        isActive: services.isActive,
      })
      .from(services)
      .where(
        and(
          eq(services.shopId, shopId),
          eq(services.isActive, true),
        ),
      );

    // Include unit/active aliases for Customer app compatibility
    const mapped = rows.map((svc) => ({
      ...svc,
      unit: svc.pricingType,
      active: svc.isActive,
    }));

    res.status(200).json(mapped);
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────
// GET /api/shops/:id/reviews
//
// Recent customer reviews for a shop (most recent first),
// each with the reviewer's first name.
// ─────────────────────────────────────────────────────────

export async function getShopReviews(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const shopId = parseUUID(req.params.id as string, "shop ID");

    const rows = await db
      .select({
        id: reviews.id,
        rating: reviews.rating,
        comment: reviews.comment,
        createdAt: reviews.createdAt,
        customerName: users.name,
      })
      .from(reviews)
      .innerJoin(users, eq(users.id, reviews.customerId))
      .where(eq(reviews.shopId, shopId))
      .orderBy(desc(reviews.createdAt))
      .limit(50);

    const mapped = rows.map((r) => ({
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      createdAt: r.createdAt,
      // First name only, for privacy
      customerName: (r.customerName ?? "Customer").split(" ")[0],
    }));

    res.status(200).json(mapped);
  } catch (err) {
    next(err);
  }
}
