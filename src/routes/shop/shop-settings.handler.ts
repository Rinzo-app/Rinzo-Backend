import type { Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { shops } from "../../db/schema/shops.js";
import type { AuthenticatedRequest } from "../../lib/types.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../lib/errors.js";
import { storageImageUrl } from "../../lib/validate-image-url.js";
import { getShopOutstanding } from "../../lib/shop-payout.js";

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

// Indian mobile: optional +91 / 0 prefix, then 10 digits starting 6-9
const phoneField = z
  .string()
  .transform((v) => v.replace(/[\s-]/g, ""))
  .pipe(
    z
      .string()
      .regex(/^(\+91|0)?[6-9]\d{9}$/, "Enter a valid 10-digit mobile number"),
  );

const updateSettingsBody = z.object({
  name: z.string().min(1).max(100).optional(),
  phone: phoneField.optional(),
  address: z.string().min(1).max(500).optional(),
  isOpen: z.boolean().optional(),
  dailyCapacity: z.number().int().positive().optional(),
  autoRejectEnabled: z.boolean().optional(),
  serviceRadiusKm: z.number().int().min(1).max(50).optional(),
  imageUrl: storageImageUrl.nullable().optional(),
  openTime: z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM").optional(),
  closeTime: z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM").optional(),
  // ── Payout details ──
  payoutMethod: z.enum(["BANK", "UPI"]).optional(),
  bankAccountName: z.string().trim().max(120).optional(),
  bankAccountNumber: z.string().trim().regex(/^\d{6,18}$/, "Enter a valid account number").optional(),
  bankIfsc: z.string().trim().regex(/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/, "Enter a valid IFSC code").optional(),
  upiId: z.string().trim().regex(/^[\w.\-]{2,}@[\w.\-]{2,}$/, "Enter a valid UPI ID").optional(),
});

// ── Shop business-document submission ────────────────────
const shopDocsSchema = z
  .object({
    panNumber: z.string().trim().regex(/^[A-Za-z]{5}\d{4}[A-Za-z]$/, "Enter a valid PAN").optional(),
    gstNumber: z.string().trim().max(20).optional(),
    panImageUrl: storageImageUrl.optional(),
    licenseImageUrl: storageImageUrl.optional(),
  })
  .refine(
    (b) => b.panNumber || b.gstNumber || b.panImageUrl || b.licenseImageUrl,
    { message: "Provide at least one document" },
  );

// ── Zod schema for shop creation ─────────────────────────

const createShopBody = z.object({
  name: z.string().min(1).max(200),
  phone: phoneField,
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
      serviceRadiusKm: shop.serviceRadiusKm,
    });
  } catch (err) {
    next(err);
  }
}

// ──────────────────────────────────────────────────────────
// GET /api/shop/settings
// ──────────────────────────────────────────────────────────

/** Common shop → settings payload (payout + KYC fields included). */
function shopSettingsPayload(shop: typeof shops.$inferSelect) {
  return {
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
    serviceRadiusKm: shop.serviceRadiusKm,
    imageUrl: shop.imageUrl,
    openTime: shop.openTime,
    closeTime: shop.closeTime,
    payoutMethod: shop.payoutMethod,
    bankAccountName: shop.bankAccountName,
    bankAccountNumber: shop.bankAccountNumber,
    bankIfsc: shop.bankIfsc,
    upiId: shop.upiId,
    panNumber: shop.panNumber,
    gstNumber: shop.gstNumber,
    panImageUrl: shop.panImageUrl,
    licenseImageUrl: shop.licenseImageUrl,
    documentsStatus: shop.documentsStatus,
    documentsRejectionReason: shop.documentsRejectionReason,
  };
}

export async function getSettings(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const shop = await resolveOwnerShop(req.user.id);
    const { earned, paidOut, balance } = await getShopOutstanding(shop.id);
    res.json({ ...shopSettingsPayload(shop), earnings: { earned, paidOut, balance } });
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
    if (parsed.data.serviceRadiusKm !== undefined)
      setFields.serviceRadiusKm = parsed.data.serviceRadiusKm;
    if (parsed.data.imageUrl !== undefined)
      setFields.imageUrl = parsed.data.imageUrl;
    if (parsed.data.openTime !== undefined) setFields.openTime = parsed.data.openTime;
    if (parsed.data.closeTime !== undefined) setFields.closeTime = parsed.data.closeTime;
    for (const f of ["payoutMethod", "bankAccountName", "bankAccountNumber", "bankIfsc", "upiId"] as const) {
      if (parsed.data[f] !== undefined) setFields[f] = parsed.data[f];
    }

    if (Object.keys(setFields).length === 0) {
      throw new BadRequestError("No fields to update");
    }

    const [updated] = await db
      .update(shops)
      .set(setFields)
      .where(eq(shops.id, shop.id))
      .returning();

    res.json(shopSettingsPayload(updated));
  } catch (err) {
    next(err);
  }
}

// ──────────────────────────────────────────────────────────
// PATCH /api/shop/documents
// Owner submits business KYC (PAN / GST / shop licence) for review.
// ──────────────────────────────────────────────────────────

export async function submitShopDocuments(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const shop = await resolveOwnerShop(req.user.id);

    const parsed = shopDocsSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError(
        parsed.error.errors[0]?.message ?? "Invalid body",
      );
    }

    const [updated] = await db
      .update(shops)
      .set({
        ...(parsed.data.panNumber !== undefined ? { panNumber: parsed.data.panNumber } : {}),
        ...(parsed.data.gstNumber !== undefined ? { gstNumber: parsed.data.gstNumber } : {}),
        ...(parsed.data.panImageUrl !== undefined ? { panImageUrl: parsed.data.panImageUrl } : {}),
        ...(parsed.data.licenseImageUrl !== undefined ? { licenseImageUrl: parsed.data.licenseImageUrl } : {}),
        documentsStatus: "SUBMITTED",
        documentsRejectionReason: null,
      })
      .where(eq(shops.id, shop.id))
      .returning();

    res.json(shopSettingsPayload(updated));
  } catch (err) {
    next(err);
  }
}
