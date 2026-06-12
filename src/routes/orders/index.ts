import { Router } from "express";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireRole } from "../../middleware/require-role.js";
import { authed } from "../../lib/typed-handler.js";
import { createOrder, cancelOrder, acceptOrder, rejectOrder, markReady, weighOrder, approveAdjustment } from "./orders.handler.js";
import { getOrderById, getOrderEvents } from "./orders.read.js";

const ordersRouter = Router();

ordersRouter.get(
  "/:id",
  requireAuth,
  authed(getOrderById),
);

ordersRouter.get(
  "/:id/events",
  requireAuth,
  authed(getOrderEvents),
);

ordersRouter.post(
  "/",
  requireAuth,
  requireRole("CUSTOMER"),
  authed(createOrder),
);

ordersRouter.post(
  "/:id/cancel",
  requireAuth,
  requireRole("CUSTOMER"),
  authed(cancelOrder),
);

ordersRouter.post(
  "/:id/accept",
  requireAuth,
  requireRole("SHOP_OWNER"),
  authed(acceptOrder),
);

ordersRouter.post(
  "/:id/reject",
  requireAuth,
  requireRole("SHOP_OWNER"),
  authed(rejectOrder),
);

ordersRouter.post(
  "/:id/weigh",
  requireAuth,
  requireRole("SHOP_OWNER"),
  authed(weighOrder),
);

ordersRouter.post(
  "/:id/approve-adjustment",
  requireAuth,
  requireRole("CUSTOMER"),
  authed(approveAdjustment),
);

ordersRouter.post(
  "/:id/ready",
  requireAuth,
  requireRole("SHOP_OWNER"),
  authed(markReady),
);

export { ordersRouter };
