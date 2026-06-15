import type { Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "../../db/client.js";
import { platformSettings } from "../../db/schema/platform-settings.js";
import { adminEvents } from "../../db/schema/admin-events.js";
import type { AuthenticatedRequest } from "../../lib/types.js";
import { BadRequestError } from "../../lib/errors.js";
import { applyPricingRow } from "../../lib/pricing-config.js";
import { eq } from "drizzle-orm";

// ─────────────────────────────────────────────────────────
// Operator pricing/timeout configuration (ADMIN only).
// GET /api/admin/settings  · PATCH /api/admin/settings
// ─────────────────────────────────────────────────────────

/** Ensure exactly one settings row exists and return it. */
async function getOrCreateRow() {
  const [existing] = await db.select().from(platformSettings).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(platformSettings).values({}).returning();
  return created;
}

export async function getSettings(
  _req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const row = await getOrCreateRow();
    res.json(row);
  } catch (err) {
    next(err);
  }
}

// Money fields in paise; commission in basis points (0–10000 = 0–100%).
const paise = z.number().int().min(0).max(1_000_000);
const updateSchema = z
  .object({
    deliveryRatePerKm: paise.optional(),
    minDeliveryFee: paise.optional(),
    fallbackDeliveryFee: paise.optional(),
    riderPayoutPerKm: paise.optional(),
    riderMinPayout: paise.optional(),
    platformFee: paise.optional(),
    commissionBps: z.number().int().min(0).max(10_000).optional(),
    placedTimeoutMin: z.number().int().min(5).max(1440).optional(),
    noRiderTimeoutMin: z.number().int().min(5).max(1440).optional(),
    pickupSlaMin: z.number().int().min(5).max(1440).optional(),
    deliverySlaMin: z.number().int().min(5).max(1440).optional(),
    cancellationFee: paise.optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "No fields to update" });

export async function updateSettings(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError(
        parsed.error.issues.map((i) => i.message).join("; "),
      );
    }

    const row = await getOrCreateRow();
    const [updated] = await db
      .update(platformSettings)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(platformSettings.id, row.id))
      .returning();

    // Push straight into the in-memory pricing cache so it takes effect now.
    applyPricingRow(updated);

    await db.insert(adminEvents).values({
      adminId: req.user.id,
      action: "UPDATE_SETTINGS",
      targetType: "PLATFORM",
      targetId: updated.id,
      details: parsed.data,
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
}
