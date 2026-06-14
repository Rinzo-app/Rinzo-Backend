import { Router } from "express";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireRole } from "../../middleware/require-role.js";
import { requireApprovedRider } from "../../middleware/require-approved-rider.js";
import { requireEmailVerified } from "../../middleware/require-email-verified.js";
import { authed } from "../../lib/typed-handler.js";
import { getRiderProfile, updateRiderProfile, submitDocuments, toggleAvailability, updateLocation, acceptOffer, declineOffer, pickupOrder, dropoffOrder, deliverOrder, collectCash } from "./rider.handler.js";
import { getRiderEarnings } from "./rider-earnings.handler.js";
import { getSettlementInfo, startSettlementPayment, checkSettlementStatus } from "./rider-settlement.handler.js";
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

// Document submission — allowed for PENDING riders (it's part of
// completing their profile before approval).
riderRouter.patch(
  "/documents",
  requireAuth,
  requireRole("RIDER"),
  authed(submitDocuments),
);

riderRouter.get(
  "/earnings",
  requireAuth,
  requireRole("RIDER"),
  authed(getRiderEarnings),
);

// ── COD settlement (rider pays the platform what they owe) ──
riderRouter.get(
  "/settlement",
  requireAuth,
  requireRole("RIDER"),
  authed(getSettlementInfo),
);
riderRouter.post(
  "/settlement/pay",
  requireAuth,
  requireRole("RIDER"),
  requireApprovedRider(),
  authed(startSettlementPayment),
);
riderRouter.get(
  "/settlement/:id/status",
  requireAuth,
  requireRole("RIDER"),
  authed(checkSettlementStatus),
);

// ── Action endpoints — require APPROVED rider status ─────
riderRouter.post(
  "/availability",
  requireAuth,
  requireRole("RIDER"),
  requireApprovedRider(),
  requireEmailVerified,
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
  "/orders/:id/accept",
  requireAuth,
  requireRole("RIDER"),
  requireApprovedRider(),
  authed(acceptOffer),
);

riderRouter.post(
  "/orders/:id/decline",
  requireAuth,
  requireRole("RIDER"),
  requireApprovedRider(),
  authed(declineOffer),
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

riderRouter.post(
  "/orders/:id/collect-cash",
  requireAuth,
  requireRole("RIDER"),
  requireApprovedRider(),
  authed(collectCash),
);

export { riderRouter };
