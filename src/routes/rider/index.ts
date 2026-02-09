import { Router } from "express";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireRole } from "../../middleware/require-role.js";
import { toggleAvailability, updateLocation, pickupOrder, dropoffOrder, deliverOrder } from "./rider.handler.js";
import { getRiderEarnings } from "./rider-earnings.handler.js";
import { listRiderOrders } from "../orders/orders.read.js";

const riderRouter = Router();

riderRouter.get(
  "/earnings",
  requireAuth,
  requireRole("RIDER"),
  getRiderEarnings as any,
);

riderRouter.post(
  "/availability",
  requireAuth,
  requireRole("RIDER"),
  toggleAvailability as any,
);

riderRouter.post(
  "/location",
  requireAuth,
  requireRole("RIDER"),
  updateLocation as any,
);

riderRouter.get(
  "/orders",
  requireAuth,
  requireRole("RIDER"),
  listRiderOrders as any,
);

riderRouter.post(
  "/orders/:id/pickup",
  requireAuth,
  requireRole("RIDER"),
  pickupOrder as any,
);

riderRouter.post(
  "/orders/:id/dropoff",
  requireAuth,
  requireRole("RIDER"),
  dropoffOrder as any,
);

riderRouter.post(
  "/orders/:id/deliver",
  requireAuth,
  requireRole("RIDER"),
  deliverOrder as any,
);

export { riderRouter };
