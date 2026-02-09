import { Router } from "express";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireRole } from "../../middleware/require-role.js";
import { assignPickup, assignDelivery } from "./admin.handler.js";
import {
  listUsers,
  approveUser,
  rejectUser,
  suspendUser,
} from "./admin-users.handler.js";
import { listAllOrders } from "../orders/orders.read.js";

const adminRouter = Router();

// ── Order management ─────────────────────────────────────
adminRouter.get(
  "/orders",
  requireAuth,
  requireRole("ADMIN"),
  listAllOrders as any,
);

adminRouter.post(
  "/orders/:id/assign-pickup",
  requireAuth,
  requireRole("ADMIN"),
  assignPickup as any,
);

adminRouter.post(
  "/orders/:id/assign-delivery",
  requireAuth,
  requireRole("ADMIN"),
  assignDelivery as any,
);

// ── User management ──────────────────────────────────────
adminRouter.get(
  "/users",
  requireAuth,
  requireRole("ADMIN"),
  listUsers as any,
);

adminRouter.post(
  "/users/:id/approve",
  requireAuth,
  requireRole("ADMIN"),
  approveUser as any,
);

adminRouter.post(
  "/users/:id/reject",
  requireAuth,
  requireRole("ADMIN"),
  rejectUser as any,
);

adminRouter.post(
  "/users/:id/suspend",
  requireAuth,
  requireRole("ADMIN"),
  suspendUser as any,
);

// ── Payment management ───────────────────────────────────
import { markPaymentCollected } from "./admin-payments.handler.js";

adminRouter.post(
  "/payments/:id/mark-collected",
  requireAuth,
  requireRole("ADMIN"),
  markPaymentCollected as any,
);

// ── Earnings reporting ───────────────────────────────────
import { getAdminEarnings } from "./admin-earnings.handler.js";

adminRouter.get(
  "/earnings",
  requireAuth,
  requireRole("ADMIN"),
  getAdminEarnings as any,
);

// ── Refunds ──────────────────────────────────────────────
import { refundOrder } from "./admin-refunds.handler.js";

adminRouter.post(
  "/orders/:id/refund",
  requireAuth,
  requireRole("ADMIN"),
  refundOrder as any,
);

// ── Rider earnings ───────────────────────────────────────
import { getAdminRiderEarnings } from "./admin-rider-earnings.handler.js";

adminRouter.get(
  "/rider-earnings",
  requireAuth,
  requireRole("ADMIN"),
  getAdminRiderEarnings as any,
);

// ── Rider payouts & balance ──────────────────────────────
import { markRiderPayout, getRiderBalance } from "./admin-rider-payouts.handler.js";

adminRouter.post(
  "/riders/:id/payout",
  requireAuth,
  requireRole("ADMIN"),
  markRiderPayout as any,
);

adminRouter.get(
  "/riders/:id/balance",
  requireAuth,
  requireRole("ADMIN"),
  getRiderBalance as any,
);

// ── Disputes ─────────────────────────────────────────────
import {
  listDisputes,
  updateDispute,
} from "./admin-disputes.handler.js";

adminRouter.get(
  "/disputes",
  requireAuth,
  requireRole("ADMIN"),
  listDisputes as any,
);

adminRouter.patch(
  "/disputes/:id",
  requireAuth,
  requireRole("ADMIN"),
  updateDispute as any,
);

export { adminRouter };
