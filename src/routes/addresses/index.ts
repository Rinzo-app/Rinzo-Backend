import { Router } from "express";
import type { Response, NextFunction } from "express";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { addresses } from "../../db/schema/addresses.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireRole } from "../../middleware/require-role.js";
import { authed } from "../../lib/typed-handler.js";
import { parseUUID } from "../../lib/validate-uuid.js";
import { BadRequestError, NotFoundError, ForbiddenError } from "../../lib/errors.js";
import type { AuthenticatedRequest } from "../../lib/types.js";

const addressesRouter = Router();

// ── Zod schema for create-address body ───────────────────
const createAddressBody = z.object({
  label: z.string().min(1).max(50),
  addressLine: z.string().min(1).max(500),
  // Coordinates are required: delivery fees and rider routing depend on
  // an honest pickup/delivery location.
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  isDefault: z.boolean().optional(),
});

// ──────────────────────────────────────────────────────────
// GET /api/addresses
//
// Returns all addresses for the authenticated customer,
// ordered by isDefault DESC, createdAt DESC.
// ──────────────────────────────────────────────────────────

async function listAddresses(
  req: AuthenticatedRequest,
  res: Response,
  _next: NextFunction,
): Promise<void> {
  const rows = await db
    .select()
    .from(addresses)
    .where(eq(addresses.customerId, req.user.id))
    .orderBy(desc(addresses.isDefault), desc(addresses.createdAt));

  res.json(rows);
}

// ──────────────────────────────────────────────────────────
// POST /api/addresses
//
// Creates a new address. If isDefault: true, unsets any
// existing default first.
// ──────────────────────────────────────────────────────────

async function createAddress(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const parsed = createAddressBody.safeParse(req.body);
  if (!parsed.success) {
    return next(
      new BadRequestError(parsed.error.errors[0]?.message ?? "Invalid body"),
    );
  }

  const { label, addressLine, lat, lng, isDefault } = parsed.data;
  const customerId = req.user.id;

  // If setting as default, unset all existing defaults first
  if (isDefault) {
    await db
      .update(addresses)
      .set({ isDefault: false })
      .where(
        and(eq(addresses.customerId, customerId), eq(addresses.isDefault, true)),
      );
  }

  const [created] = await db
    .insert(addresses)
    .values({
      customerId,
      label,
      addressLine,
      lat,
      lng,
      isDefault: isDefault ?? false,
    })
    .returning();

  res.status(201).json(created);
}

// ──────────────────────────────────────────────────────────
// DELETE /api/addresses/:id
//
// Deletes an address. Verifies ownership.
// ──────────────────────────────────────────────────────────

async function deleteAddress(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const addressId = parseUUID(req.params.id as string, "address ID");

  const [existing] = await db
    .select()
    .from(addresses)
    .where(eq(addresses.id, addressId))
    .limit(1);

  if (!existing) {
    return next(new NotFoundError("Address not found"));
  }

  if (existing.customerId !== req.user.id) {
    return next(new ForbiddenError("You can only delete your own addresses"));
  }

  await db.delete(addresses).where(eq(addresses.id, addressId));

  res.status(204).end();
}

// ──────────────────────────────────────────────────────────
// PUT /api/addresses/:id/default
//
// Sets an address as the default. Unsets all other defaults
// for this customer first. Verifies ownership.
// ──────────────────────────────────────────────────────────

async function setDefault(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const addressId = parseUUID(req.params.id as string, "address ID");
  const customerId = req.user.id;

  const [existing] = await db
    .select()
    .from(addresses)
    .where(eq(addresses.id, addressId))
    .limit(1);

  if (!existing) {
    return next(new NotFoundError("Address not found"));
  }

  if (existing.customerId !== customerId) {
    return next(new ForbiddenError("You can only modify your own addresses"));
  }

  // Unset all defaults for this customer
  await db
    .update(addresses)
    .set({ isDefault: false })
    .where(
      and(eq(addresses.customerId, customerId), eq(addresses.isDefault, true)),
    );

  // Set new default
  const [updated] = await db
    .update(addresses)
    .set({ isDefault: true })
    .where(eq(addresses.id, addressId))
    .returning();

  res.json(updated);
}

// ── Mount handlers ───────────────────────────────────────

addressesRouter.get(
  "/",
  requireAuth,
  requireRole("CUSTOMER"),
  authed(listAddresses),
);

addressesRouter.post(
  "/",
  requireAuth,
  requireRole("CUSTOMER"),
  authed(createAddress),
);

addressesRouter.delete(
  "/:id",
  requireAuth,
  requireRole("CUSTOMER"),
  authed(deleteAddress),
);

addressesRouter.put(
  "/:id/default",
  requireAuth,
  requireRole("CUSTOMER"),
  authed(setDefault),
);

export { addressesRouter };
