import { Router } from "express";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireRole } from "../../middleware/require-role.js";
import { requireApprovedRider } from "../../middleware/require-approved-rider.js";
import { authed } from "../../lib/typed-handler.js";
import { getRiderProfile, updateRiderProfile, toggleAvailability, updateLocation, pickupOrder, dropoffOrder, deliverOrder } from "./rider.handler.js";
import { getRiderEarnings } from "./rider-earnings.handler.js";
import { listRiderOrders } from "../orders/orders.read.js";

const riderRouter = Router();

// ── Profile & earnings — accessible by PENDING riders so
//    the status-blocked screen can still poll.
riderRouter.get(
  "/profile",
  requireAuth,
  requireRole("RIDER"),
  authed(getRiderProfile),
);

// Vehicle details edit — allowed for PENDING riders too, so they can
// complete their profile while awaiting approval.
riderRouter.patch(
  "/profile",
  requireAuth,
  requireRole("RIDER"),
  authed(updateRiderProfile),
);

riderRouter.get(
  "/earnings",
  requireAuth,
  requireRole("RIDER"),
  authed(getRiderEarnings),
);

// ── Action endpoints — require APPROVED rider status ─────
riderRouter.post(
  "/availability",
  requireAuth,
  requireRole("RIDER"),
  requireApprovedRider(),
  authed(toggleAvailability),
);

riderRouter.post(
  "/location",
  requireAuth,
  requireRole("RIDER"),
  requireApprovedRider(),
  authed(updateLocation),
);

riderRouter.get(
  "/orders",
  requireAuth,
  requireRole("RIDER"),
  requireApprovedRider(),
  authed(listRiderOrders),
);

riderRouter.post(
  "/orders/:id/pickup",
  requireAuth,
  requireRole("RIDER"),
  requireApprovedRider(),
  authed(pickupOrder),
);

riderRouter.post(
  "/orders/:id/dropoff",
  requireAuth,
  requireRole("RIDER"),
  requireApprovedRider(),
  authed(dropoffOrder),
);

riderRouter.post(
  "/orders/:id/deliver",
  requireAuth,
  requireRole("RIDER"),
  requireApprovedRider(),
  authed(deliverOrder),
);

export { riderRouter };
