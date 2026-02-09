import { Router } from "express";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireRole } from "../../middleware/require-role.js";
import { listShopOrders } from "../orders/orders.read.js";
import { getShopEarnings } from "./shop-earnings.handler.js";

const shopRouter = Router();

shopRouter.get(
  "/orders",
  requireAuth,
  requireRole("SHOP_OWNER"),
  listShopOrders as any,
);

shopRouter.get(
  "/earnings",
  requireAuth,
  requireRole("SHOP_OWNER"),
  getShopEarnings as any,
);

export { shopRouter };
