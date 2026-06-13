import type { Response, NextFunction } from "express";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { shops } from "../../db/schema/shops.js";
import { services } from "../../db/schema/services.js";
import type { AuthenticatedRequest } from "../../lib/types.js";
import { parseUUID } from "../../lib/validate-uuid.js";
import {
  BadRequestError,
  NotFoundError,
  ForbiddenError,
} from "../../lib/errors.js";

// ── Helper: resolve first shop owned by user ─────────────

async function resolveOwnerShop(ownerId: string) {
  const [shop] = await db
    .select({ id: shops.id })
    .from(shops)
    .where(eq(shops.ownerId, ownerId))
    .limit(1);

  if (!shop) {
    throw new NotFoundError("No shop found for this user", "ERR_NO_SHOPS");
  }
  return shop;
}

// ── Zod schemas ──────────────────────────────────────────

const createServiceBody = z.object({
  name: z.string().min(1).max(200),
  price: z.number().int().positive().max(100000),
  pricingType: z
    .enum(["PER_KG", "PER_ITEM"])
    .optional()
    .default("PER_KG"),
  isActive: z.boolean().optional().default(true),
  imageUrl: z.string().url().max(1000).nullable().optional(),
});

const updateServiceBody = z.object({
  name: z.string().min(1).max(200).optional(),
  price: z.number().int().positive().max(100000).optional(),
  pricingType: z.enum(["PER_KG", "PER_ITEM"]).optional(),
  isActive: z.boolean().optional(),
  imageUrl: z.string().url().max(1000).nullable().optional(),
});

// ──────────────────────────────────────────────────────────
// GET /api/shop/services
// ──────────────────────────────────────────────────────────

export async function listServices(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const shop = await resolveOwnerShop(req.user.id);

    const rows = await db
      .select({
        id: services.id,
        name: services.name,
        price: services.price,
        pricingType: services.pricingType,
        isActive: services.isActive,
        imageUrl: services.imageUrl,
      })
      .from(services)
      .where(eq(services.shopId, shop.id));

    res.json(rows);
  } catch (err) {
    next(err);
  }
}

// ──────────────────────────────────────────────────────────
// POST /api/shop/services
// ──────────────────────────────────────────────────────────

export async function createService(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const shop = await resolveOwnerShop(req.user.id);

    const parsed = createServiceBody.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError(
        parsed.error.errors[0]?.message ?? "Invalid body",
      );
    }

    const [created] = await db
      .insert(services)
      .values({
        shopId: shop.id,
        name: parsed.data.name,
        price: parsed.data.price,
        pricingType: parsed.data.pricingType,
        isActive: parsed.data.isActive,
        ...(parsed.data.imageUrl !== undefined
          ? { imageUrl: parsed.data.imageUrl }
          : {}),
      })
      .returning();

    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
}

// ──────────────────────────────────────────────────────────
// PATCH /api/shop/services/:id
// ──────────────────────────────────────────────────────────

export async function updateService(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const serviceId = parseUUID(req.params.id as string, "service ID");
    const shop = await resolveOwnerShop(req.user.id);

    // Verify the service belongs to this shop
    const [existing] = await db
      .select({ id: services.id, shopId: services.shopId })
      .from(services)
      .where(eq(services.id, serviceId))
      .limit(1);

    if (!existing) {
      throw new NotFoundError("Service not found");
    }
    if (existing.shopId !== shop.id) {
      throw new ForbiddenError("Service does not belong to your shop");
    }

    const parsed = updateServiceBody.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError(
        parsed.error.errors[0]?.message ?? "Invalid body",
      );
    }

    // Build the set object with only provided fields
    const setFields: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) setFields.name = parsed.data.name;
    if (parsed.data.price !== undefined) setFields.price = parsed.data.price;
    if (parsed.data.pricingType !== undefined)
      setFields.pricingType = parsed.data.pricingType;
    if (parsed.data.isActive !== undefined)
      setFields.isActive = parsed.data.isActive;
    if (parsed.data.imageUrl !== undefined)
      setFields.imageUrl = parsed.data.imageUrl;

    if (Object.keys(setFields).length === 0) {
      throw new BadRequestError("No fields to update");
    }

    const [updated] = await db
      .update(services)
      .set(setFields)
      .where(eq(services.id, serviceId))
      .returning();

    res.json(updated);
  } catch (err) {
    next(err);
  }
}

// ──────────────────────────────────────────────────────────
// DELETE /api/shop/services/:id
// ──────────────────────────────────────────────────────────

export async function deleteService(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const serviceId = parseUUID(req.params.id as string, "service ID");
    const shop = await resolveOwnerShop(req.user.id);

    const [existing] = await db
      .select({ id: services.id, shopId: services.shopId })
      .from(services)
      .where(eq(services.id, serviceId))
      .limit(1);

    if (!existing) {
      throw new NotFoundError("Service not found");
    }
    if (existing.shopId !== shop.id) {
      throw new ForbiddenError("Service does not belong to your shop");
    }

    await db.delete(services).where(eq(services.id, serviceId));

    res.status(204).end();
  } catch (err) {
    next(err);
  }
}
