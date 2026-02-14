import { Router } from "express";
import type { Response, NextFunction } from "express";
import { eq, and } from "drizzle-orm";
import { db } from "../../db/client.js";
import { favorites } from "../../db/schema/favorites.js";
import { shops } from "../../db/schema/shops.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireRole } from "../../middleware/require-role.js";
import { authed } from "../../lib/typed-handler.js";
import { parseUUID } from "../../lib/validate-uuid.js";
import type { AuthenticatedRequest } from "../../lib/types.js";

const favoritesRouter = Router();

// ──────────────────────────────────────────────────────────
// GET /api/favorites
//
// Returns all favorite shops for the authenticated customer.
// Joins with shops to return shop details.
// ──────────────────────────────────────────────────────────

async function listFavorites(
  req: AuthenticatedRequest,
  res: Response,
  _next: NextFunction,
): Promise<void> {
  const rows = await db
    .select({
      id: favorites.id,
      shopId: favorites.shopId,
      createdAt: favorites.createdAt,
      shopName: shops.name,
      shopAddress: shops.address,
      shopIsOpen: shops.isOpen,
      shopLatitude: shops.latitude,
      shopLongitude: shops.longitude,
    })
    .from(favorites)
    .innerJoin(shops, eq(favorites.shopId, shops.id))
    .where(eq(favorites.customerId, req.user.id));

  res.json(rows);
}

// ──────────────────────────────────────────────────────────
// POST /api/favorites/:id/toggle
//
// :id is the shop ID. If favorite exists → delete it.
// If not → insert. Return { isFavorite: boolean }.
// ──────────────────────────────────────────────────────────

async function toggleFavorite(
  req: AuthenticatedRequest,
  res: Response,
  _next: NextFunction,
): Promise<void> {
  const shopId = parseUUID(req.params.id as string, "shop ID");
  const customerId = req.user.id;

  const [existing] = await db
    .select({ id: favorites.id })
    .from(favorites)
    .where(and(eq(favorites.customerId, customerId), eq(favorites.shopId, shopId)))
    .limit(1);

  if (existing) {
    await db.delete(favorites).where(eq(favorites.id, existing.id));
    res.json({ isFavorite: false });
  } else {
    await db.insert(favorites).values({ customerId, shopId });
    res.json({ isFavorite: true });
  }
}

// ──────────────────────────────────────────────────────────
// GET /api/favorites/:id/check
//
// :id is the shop ID. Return { isFavorite: boolean }.
// ──────────────────────────────────────────────────────────

async function checkFavorite(
  req: AuthenticatedRequest,
  res: Response,
  _next: NextFunction,
): Promise<void> {
  const shopId = parseUUID(req.params.id as string, "shop ID");

  const [existing] = await db
    .select({ id: favorites.id })
    .from(favorites)
    .where(and(eq(favorites.customerId, req.user.id), eq(favorites.shopId, shopId)))
    .limit(1);

  res.json({ isFavorite: !!existing });
}

// ── Mount handlers ───────────────────────────────────────

favoritesRouter.get(
  "/",
  requireAuth,
  requireRole("CUSTOMER"),
  authed(listFavorites),
);

favoritesRouter.post(
  "/:id/toggle",
  requireAuth,
  requireRole("CUSTOMER"),
  authed(toggleFavorite),
);

favoritesRouter.get(
  "/:id/check",
  requireAuth,
  requireRole("CUSTOMER"),
  authed(checkFavorite),
);

export { favoritesRouter };
