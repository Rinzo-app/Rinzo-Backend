import type { Response, NextFunction } from "express";
import { eq, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { orders } from "../../db/schema/orders.js";
import { payments } from "../../db/schema/payments.js";
import { refunds } from "../../db/schema/refunds.js";
import { ledgerEntries } from "../../db/schema/ledger-entries.js";
import { adminEvents } from "../../db/schema/admin-events.js";
import { COMMISSION_RATE } from "../../lib/economics.js";
import type { AuthenticatedRequest } from "../../lib/types.js";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from "../../lib/errors.js";

// ─────────────────────────────────────────────────────────
// POST /api/admin/orders/:id/refund
//
// ADMIN only. Issues a refund for a COD-collected order
// in a terminal state (DELIVERED, CANCELLED, REJECTED_BY_SHOP).
// Platform fee is retained.
// ─────────────────────────────────────────────────────────

export async function refundOrder(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const orderId = req.params.id as string;
    const adminId = req.user.id;
    const note = typeof req.body?.note === "string" ? req.body.note : null;

    // ── 1. Fetch order ────────────────────────────────────
    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);

    if (!order) {
      throw new NotFoundError("Order not found", "ERR_ORDER_NOT_FOUND");
    }

    // ── 2. Guard: order must be in a refundable terminal state ─
    const REFUNDABLE_STATUSES = ["DELIVERED", "CANCELLED", "REJECTED_BY_SHOP"];
    if (!REFUNDABLE_STATUSES.includes(order.status)) {
      throw new BadRequestError(
        `Order status is ${order.status}, must be one of ${REFUNDABLE_STATUSES.join(", ")} to refund`,
        "ERR_ORDER_NOT_REFUNDABLE",
      );
    }

    // ── 3. Fetch payment ──────────────────────────────────
    const [payment] = await db
      .select()
      .from(payments)
      .where(eq(payments.orderId, orderId))
      .limit(1);

    if (!payment) {
      throw new NotFoundError(
        "No payment found for this order",
        "ERR_PAYMENT_NOT_FOUND",
      );
    }

    // ── 4. Guard: payment must be COLLECTED ───────────────
    if (payment.status !== "COLLECTED") {
      throw new BadRequestError(
        `Payment status is ${payment.status}, must be COLLECTED to refund`,
        "ERR_PAYMENT_NOT_COLLECTED",
      );
    }

    // ── 5. Guard: no duplicate refund ─────────────────────
    const [existingRefund] = await db
      .select({ id: refunds.id })
      .from(refunds)
      .where(eq(refunds.paymentId, payment.id))
      .limit(1);

    if (existingRefund) {
      throw new ConflictError(
        "Refund already exists for this payment",
        "ERR_REFUND_EXISTS",
      );
    }

    // ── 6. Compute amounts ────────────────────────────────
    const refundAmount = order.totalAmount; // excludes platformFee
    const commission = Math.round(order.totalAmount * COMMISSION_RATE);
    const shopEarning = order.totalAmount - commission;

    // ── 7. Transaction: refund + reversing ledger + audit ─
    const result = await db.transaction(async (tx) => {
      // Insert refund record
      const [refund] = await tx
        .insert(refunds)
        .values({
          orderId,
          paymentId: payment.id,
          amount: refundAmount,
          reason: "ADMIN_DISCRETION",
          status: "PROCESSED",
          note,
        })
        .returning();

      // Reversing ledger: negative COMMISSION back from platform
      // Reversing ledger: negative EARNING back from shop
      await tx.insert(ledgerEntries).values([
        {
          entityType: "PLATFORM",
          entityId: null,
          orderId,
          amount: -commission,
          reason: "COMMISSION_REFUND",
        },
        {
          entityType: "SHOP",
          entityId: order.shopId,
          orderId,
          amount: -shopEarning,
          reason: "EARNING_REVERSAL",
        },
      ]);

      // Audit trail
      await tx.insert(adminEvents).values({
        adminId,
        action: "REFUND_ORDER",
        targetType: "ORDER",
        targetId: orderId,
        details: {
          refundId: refund.id,
          paymentId: payment.id,
          refundAmount,
          commission,
          shopEarning,
          note,
        },
      });

      return refund;
    });

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}
