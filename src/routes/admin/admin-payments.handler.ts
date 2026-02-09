import type { Response, NextFunction } from "express";
import { eq, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { payments } from "../../db/schema/payments.js";
import { orders } from "../../db/schema/orders.js";
import { adminEvents } from "../../db/schema/admin-events.js";
import { ledgerEntries } from "../../db/schema/ledger-entries.js";
import { COMMISSION_RATE } from "../../lib/economics.js";
import type { AuthenticatedRequest } from "../../lib/types.js";
import {
  BadRequestError,
  NotFoundError,
} from "../../lib/errors.js";

// ─────────────────────────────────────────────────────────
// POST /api/admin/payments/:id/mark-collected
//
// Admin-only. Marks a COD payment as COLLECTED after the
// order has been delivered.
// ─────────────────────────────────────────────────────────
export async function markPaymentCollected(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const paymentId = req.params.id as string;
    const adminId = req.user.id;

    // ── 1. Fetch payment ──────────────────────────────────
    const [payment] = await db
      .select()
      .from(payments)
      .where(eq(payments.id, paymentId))
      .limit(1);

    if (!payment) {
      throw new NotFoundError("Payment not found", "ERR_PAYMENT_NOT_FOUND");
    }

    // ── 2. Guard: must be COD ─────────────────────────────
    if (payment.method !== "COD") {
      throw new BadRequestError(
        "Only COD payments can be marked as collected via this endpoint",
        "ERR_NOT_COD",
      );
    }

    // ── 3. Guard: must be PENDING ─────────────────────────
    if (payment.status !== "PENDING") {
      throw new BadRequestError(
        `Payment is already ${payment.status}`,
        "ERR_PAYMENT_NOT_PENDING",
      );
    }

    // ── 4. Guard: order must be DELIVERED ─────────────────
    const [order] = await db
      .select({
        status: orders.status,
        totalAmount: orders.totalAmount,
        platformFee: orders.platformFee,
        shopId: orders.shopId,
      })
      .from(orders)
      .where(eq(orders.id, payment.orderId))
      .limit(1);

    if (!order || order.status !== "DELIVERED") {
      throw new BadRequestError(
        "Order must be in DELIVERED status before payment can be collected",
        "ERR_ORDER_NOT_DELIVERED",
      );
    }

    // ── 5. Update payment in transaction + audit ─────────
    const result = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(payments)
        .set({
          status: "COLLECTED",
          collectedBy: "SYSTEM",
          collectedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(eq(payments.id, paymentId))
        .returning();

      await tx.insert(adminEvents).values({
        adminId,
        action: "MARK_PAYMENT_COLLECTED",
        targetType: "PAYMENT",
        targetId: paymentId,
        details: {
          orderId: payment.orderId,
          amount: payment.amount,
          method: payment.method,
        },
      });

      // ── Ledger entries ────────────────────────────────
      const commission = Math.round(order.totalAmount * COMMISSION_RATE);
      const shopEarning = order.totalAmount - commission;

      await tx.insert(ledgerEntries).values([
        {
          entityType: "PLATFORM",
          entityId: null,
          orderId: payment.orderId,
          amount: order.platformFee,
          reason: "PLATFORM_FEE",
        },
        {
          entityType: "PLATFORM",
          entityId: null,
          orderId: payment.orderId,
          amount: commission,
          reason: "COMMISSION",
        },
        {
          entityType: "SHOP",
          entityId: order.shopId,
          orderId: payment.orderId,
          amount: shopEarning,
          reason: "EARNING",
        },
      ]);

      return updated;
    });

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}
