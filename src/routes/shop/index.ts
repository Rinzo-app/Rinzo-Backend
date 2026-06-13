import { Router } from "express";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireRole } from "../../middleware/require-role.js";
import { requireEmailVerified } from "../../middleware/require-email-verified.js";
import { authed } from "../../lib/typed-handler.js";
import { listShopOrders } from "../orders/orders.read.js";
import { getShopEarnings } from "./shop-earnings.handler.js";
import {
  listServices,
  createService,
  updateService,
  deleteService,
} from "./shop-services.handler.js";
import { createShop, getSettings, patchSettings } from "./shop-settings.handler.js";

const shopRouter = Router();

// ── Shop onboarding ──────────────────────────────────────

shopRouter.post(
  "/",
  requireAuth,
  requireRole("SHOP_OWNER"),
  requireEmailVerified,
  authed(createShop),
);

shopRouter.get(
  "/orders",
  requireAuth,
  requireRole("SHOP_OWNER"),
  authed(listShopOrders),
);

shopRouter.get(
  "/earnings",
  requireAuth,
  requireRole("SHOP_OWNER"),
  authed(getShopEarnings),
);

// ── Service management ───────────────────────────────────

shopRouter.get(
  "/services",
  requireAuth,
  requireRole("SHOP_OWNER"),
  authed(listServices),
);

shopRouter.post(
  "/services",
  requireAuth,
  requireRole("SHOP_OWNER"),
  authed(createService),
);

shopRouter.patch(
  "/services/:id",
  requireAuth,
  requireRole("SHOP_OWNER"),
  authed(updateService),
);

shopRouter.delete(
  "/services/:id",
  requireAuth,
  requireRole("SHOP_OWNER"),
  authed(deleteService),
);

// ── Settings ─────────────────────────────────────────────

shopRouter.get(
  "/settings",
  requireAuth,
  requireRole("SHOP_OWNER"),
  authed(getSettings),
);

shopRouter.patch(
  "/settings",
  requireAuth,
  requireRole("SHOP_OWNER"),
  authed(patchSettings),
);

export { shopRouter };
