import type { Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { shops } from "../../db/schema/shops.js";
import type { AuthenticatedRequest } from "../../lib/types.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../lib/errors.js";

// ── Helper: resolve first shop owned by user ─────────────

async function resolveOwnerShop(ownerId: string) {
  const [shop] = await db
    .select()
    .from(shops)
    .where(eq(shops.ownerId, ownerId))
    .limit(1);

  if (!shop) {
    throw new NotFoundError("No shop found for this user", "ERR_NO_SHOPS");
  }
  return shop;
}

// ── Zod schema for settings update ───────────────────────

const updateSettingsBody = z.object({
  name: z.string().min(1).max(100).optional(),
  phone: z.string().min(4).max(20).optional(),
  address: z.string().min(1).max(500).optional(),
  isOpen: z.boolean().optional(),
  dailyCapacity: z.number().int().positive().optional(),
  autoRejectEnabled: z.boolean().optional(),
});

// ── Zod schema for shop creation ─────────────────────────

const createShopBody = z.object({
  name: z.string().min(1).max(200),
  phone: z.string().min(4).max(20),
  address: z.string().min(1).max(500),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  openTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  closeTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
});

// ──────────────────────────────────────────────────────────
// POST /api/shop
//
// Creates the owner's shop in PENDING status (admin must
// approve before it becomes visible to customers).
// One shop per owner in v1.
// ──────────────────────────────────────────────────────────

export async function createShop(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ownerId = req.user.id;

    const parsed = createShopBody.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError(
        parsed.error.errors[0]?.message ?? "Invalid body",
      );
    }

    const [existing] = await db
      .select({ id: shops.id })
      .from(shops)
      .where(eq(shops.ownerId, ownerId))
      .limit(1);

    if (existing) {
      throw new ConflictError(
        "You already have a shop registered",
        "ERR_SHOP_EXISTS",
      );
    }

    const [shop] = await db
      .insert(shops)
      .values({
        ownerId,
        name: parsed.data.name,
        phone: parsed.data.phone,
        address: parsed.data.address,
        latitude: parsed.data.latitude,
        longitude: parsed.data.longitude,
        ...(parsed.data.openTime ? { openTime: parsed.data.openTime } : {}),
        ...(parsed.data.closeTime ? { closeTime: parsed.data.closeTime } : {}),
        status: "PENDING",
      })
      .returning();

    res.status(201).json({
      id: shop.id,
      name: shop.name,
      phone: shop.phone,
      address: shop.address,
      lat: shop.latitude,
      lng: shop.longitude,
      status: shop.status,
      isOpen: shop.isOpen,
      dailyCapacity: shop.dailyCapacity,
      autoRejectEnabled: shop.autoRejectEnabled,
    });
  } catch (err) {
    next(err);
  }
}

// ──────────────────────────────────────────────────────────
// GET /api/shop/settings
// ──────────────────────────────────────────────────────────

export async function getSettings(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const shop = await resolveOwnerShop(req.user.id);

    res.json({
      id: shop.id,
      name: shop.name,
      phone: shop.phone,
      address: shop.address,
      lat: shop.latitude,
      lng: shop.longitude,
      status: shop.status,
      isOpen: shop.isOpen,
      dailyCapacity: shop.dailyCapacity,
      autoRejectEnabled: shop.autoRejectEnabled,
    });
  } catch (err) {
    next(err);
  }
}

// ──────────────────────────────────────────────────────────
// PATCH /api/shop/settings
// ──────────────────────────────────────────────────────────

export async function patchSettings(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const shop = await resolveOwnerShop(req.user.id);

    const parsed = updateSettingsBody.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError(
        parsed.error.errors[0]?.message ?? "Invalid body",
      );
    }

    const setFields: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) setFields.name = parsed.data.name;
    if (parsed.data.phone !== undefined) setFields.phone = parsed.data.phone;
    if (parsed.data.address !== undefined)
      setFields.address = parsed.data.address;
    if (parsed.data.isOpen !== undefined) setFields.isOpen = parsed.data.isOpen;
    if (parsed.data.dailyCapacity !== undefined)
      setFields.dailyCapacity = parsed.data.dailyCapacity;
    if (parsed.data.autoRejectEnabled !== undefined)
      setFields.autoRejectEnabled = parsed.data.autoRejectEnabled;

    if (Object.keys(setFields).length === 0) {
      throw new BadRequestError("No fields to update");
    }

    const [updated] = await db
      .update(shops)
      .set(setFields)
      .where(eq(shops.id, shop.id))
      .returning();

    res.json({
      id: updated.id,
      name: updated.name,
      phone: updated.phone,
      address: updated.address,
      lat: updated.latitude,
      lng: updated.longitude,
      status: updated.status,
      isOpen: updated.isOpen,
      dailyCapacity: updated.dailyCapacity,
      autoRejectEnabled: updated.autoRejectEnabled,
    });
  } catch (err) {
    next(err);
  }
}
