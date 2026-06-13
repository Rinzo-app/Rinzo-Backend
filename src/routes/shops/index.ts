import { Router } from "express";
import { requireAuth } from "../../middleware/require-auth.js";
import { authed } from "../../lib/typed-handler.js";
import { listShops, getShopDetail, getShopServices, getShopReviews } from "./shops.handler.js";

const shopsRouter = Router();

// ── GET /api/shops — browse all approved shops ───────────
shopsRouter.get(
  "/",
  requireAuth,
  authed(listShops),
);

// ── GET /api/shops/:id — single shop detail ─────────────
shopsRouter.get(
  "/:id",
  requireAuth,
  authed(getShopDetail),
);

// ── GET /api/shops/:id/services — active services for a shop
shopsRouter.get(
  "/:id/services",
  requireAuth,
  authed(getShopServices),
);

// ── GET /api/shops/:id/reviews — recent customer reviews ──
shopsRouter.get(
  "/:id/reviews",
  requireAuth,
  authed(getShopReviews),
);

export { shopsRouter };
