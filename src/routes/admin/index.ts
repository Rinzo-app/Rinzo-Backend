import { Router } from "express";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireRole } from "../../middleware/require-role.js";
import { authed } from "../../lib/typed-handler.js";
import { assignPickup, assignDelivery } from "./admin.handler.js";
import {
  listUsers,
  approveUser,
  rejectUser,
  rejectRiderDocuments,
  rejectShopDocuments,
  verifyUserEmail,
  deleteUserByAdmin,
  suspendUser,
  getUserImpact,
} from "./admin-users.handler.js";
import { listAllOrders } from "../orders/orders.read.js";
import { getSettings, updateSettings } from "./admin-settings.handler.js";
import { listSettlements, settleRiderCash, listShopPayouts, payShop } from "./admin-settlements.handler.js";

const adminRouter = Router();

// ── Dashboard metrics ────────────────────────────────────
import { getDashboard } from "./admin-dashboard.handler.js";

adminRouter.get(
  "/dashboard",
  requireAuth,
  requireRole("ADMIN"),
  authed(getDashboard),
);

// ── Operator pricing / timeout settings ──────────────────
adminRouter.get(
  "/settings",
  requireAuth,
  requireRole("ADMIN"),
  authed(getSettings),
);
adminRouter.patch(
  "/settings",
  requireAuth,
  requireRole("ADMIN"),
  authed(updateSettings),
);

// ── Order management ─────────────────────────────────────
adminRouter.get(
  "/orders",
  requireAuth,
  requireRole("ADMIN"),
  authed(listAllOrders),
);

adminRouter.post(
  "/orders/:id/assign-pickup",
  requireAuth,
  requireRole("ADMIN"),
  authed(assignPickup),
);

adminRouter.post(
  "/orders/:id/assign-delivery",
  requireAuth,
  requireRole("ADMIN"),
  authed(assignDelivery),
);

// ── User management ──────────────────────────────────────
adminRouter.get(
  "/users",
  requireAuth,
  requireRole("ADMIN"),
  authed(listUsers),
);

adminRouter.post(
  "/users/:id/approve",
  requireAuth,
  requireRole("ADMIN"),
  authed(approveUser),
);

adminRouter.post(
  "/users/:id/reject",
  requireAuth,
  requireRole("ADMIN"),
  authed(rejectUser),
);

adminRouter.post(
  "/riders/:id/reject-documents",
  requireAuth,
  requireRole("ADMIN"),
  authed(rejectRiderDocuments),
);

// ── Rider COD settlements ────────────────────────────────
adminRouter.get(
  "/settlements",
  requireAuth,
  requireRole("ADMIN"),
  authed(listSettlements),
);
adminRouter.post(
  "/riders/:id/settle",
  requireAuth,
  requireRole("ADMIN"),
  authed(settleRiderCash),
);

// ── Shop payouts + KYC ───────────────────────────────────
adminRouter.get(
  "/shop-payouts",
  requireAuth,
  requireRole("ADMIN"),
  authed(listShopPayouts),
);
adminRouter.post(
  "/shops/:id/payout",
  requireAuth,
  requireRole("ADMIN"),
  authed(payShop),
);
adminRouter.post(
  "/shops/:id/reject-documents",
  requireAuth,
  requireRole("ADMIN"),
  authed(rejectShopDocuments),
);

adminRouter.post(
  "/users/:id/verify-email",
  requireAuth,
  requireRole("ADMIN"),
  authed(verifyUserEmail),
);

adminRouter.post(
  "/users/:id/delete",
  requireAuth,
  requireRole("ADMIN"),
  authed(deleteUserByAdmin),
);

adminRouter.post(
  "/users/:id/suspend",
  requireAuth,
  requireRole("ADMIN"),
  authed(suspendUser),
);

adminRouter.get(
  "/users/:id/impact",
  requireAuth,
  requireRole("ADMIN"),
  authed(getUserImpact),
);

// ── Payment management ───────────────────────────────────
import { markPaymentCollected, settlePayment } from "./admin-payments.handler.js";

adminRouter.post(
  "/payments/:id/mark-collected",
  requireAuth,
  requireRole("ADMIN"),
  authed(markPaymentCollected),
);

adminRouter.post(
  "/payments/:id/settle",
  requireAuth,
  requireRole("ADMIN"),
  authed(settlePayment),
);

// ── Earnings reporting ───────────────────────────────────
import { getAdminEarnings } from "./admin-earnings.handler.js";

adminRouter.get(
  "/earnings",
  requireAuth,
  requireRole("ADMIN"),
  authed(getAdminEarnings),
);

// ── Refunds ──────────────────────────────────────────────
import { refundOrder } from "./admin-refunds.handler.js";

adminRouter.post(
  "/orders/:id/refund",
  requireAuth,
  requireRole("ADMIN"),
  authed(refundOrder),
);

// ── Rider earnings ───────────────────────────────────────
import { getAdminRiderEarnings } from "./admin-rider-earnings.handler.js";

adminRouter.get(
  "/rider-earnings",
  requireAuth,
  requireRole("ADMIN"),
  authed(getAdminRiderEarnings),
);

// ── Rider payouts & balance ──────────────────────────────
import { markRiderPayout, getRiderBalance } from "./admin-rider-payouts.handler.js";

adminRouter.post(
  "/riders/:id/payout",
  requireAuth,
  requireRole("ADMIN"),
  authed(markRiderPayout),
);

adminRouter.get(
  "/riders/:id/balance",
  requireAuth,
  requireRole("ADMIN"),
  authed(getRiderBalance),
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
  authed(listDisputes),
);

adminRouter.patch(
  "/disputes/:id",
  requireAuth,
  requireRole("ADMIN"),
  authed(updateDispute),
);

export { adminRouter };
