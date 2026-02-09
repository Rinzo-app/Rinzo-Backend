import { Router } from "express";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireRole } from "../../middleware/require-role.js";
import { createOrder, cancelOrder, acceptOrder, rejectOrder, markReady } from "./orders.handler.js";
import { getOrderById, getOrderEvents } from "./orders.read.js";
import type { AuthenticatedRequest } from "../../lib/types.js";

const ordersRouter = Router();

ordersRouter.get(
  "/:id",
  requireAuth,
  getOrderById as any,
);

ordersRouter.get(
  "/:id/events",
  requireAuth,
  getOrderEvents as any,
);

ordersRouter.post(
  "/",
  requireAuth,
  requireRole("CUSTOMER"),
  createOrder as any, // AuthenticatedRequest narrowing
);

ordersRouter.post(
  "/:id/cancel",
  requireAuth,
  requireRole("CUSTOMER"),
  cancelOrder as any,
);

ordersRouter.post(
  "/:id/accept",
  requireAuth,
  requireRole("SHOP_OWNER"),
  acceptOrder as any,
);

ordersRouter.post(
  "/:id/reject",
  requireAuth,
  requireRole("SHOP_OWNER"),
  rejectOrder as any,
);

ordersRouter.post(
  "/:id/ready",
  requireAuth,
  requireRole("SHOP_OWNER"),
  markReady as any,
);

export { ordersRouter };
