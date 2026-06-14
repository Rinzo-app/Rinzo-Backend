import type { Response, NextFunction } from "express";
import { and, eq, desc } from "drizzle-orm";
import { db } from "../../db/client.js";
import { riders } from "../../db/schema/riders.js";
import { riderSettlements } from "../../db/schema/rider-settlements.js";
import type { AuthenticatedRequest } from "../../lib/types.js";
import { NotFoundError, BadRequestError, ConflictError, ForbiddenError } from "../../lib/errors.js";
import { getRiderOutstanding, settlePaymentsInTx } from "../../lib/rider-settlement.js";
import { getPaymentProvider } from "../../lib/payments/index.js";

async function resolveRider(userId: string) {
  const [rider] = await db
    .select({ id: riders.id })
    .from(riders)
    .where(eq(riders.userId, userId))
    .limit(1);
  if (!rider) throw new NotFoundError("Rider profile not found", "ERR_RIDER_NOT_FOUND");
  return rider;
}

// ── GET /api/rider/settlement — current dues + any pending UPI settlement ──
export async function getSettlementInfo(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const rider = await resolveRider(req.user.id);
    const outstanding = await getRiderOutstanding(rider.id);
    const [pending] = await db
      .select()
      .from(riderSettlements)
      .where(and(eq(riderSettlements.riderId, rider.id), eq(riderSettlements.status, "PENDING")))
      .orderBy(desc(riderSettlements.createdAt))
      .limit(1);
    res.json({ ...outstanding, pendingSettlement: pending ?? null });
  } catch (err) {
    next(err);
  }
}

// ── POST /api/rider/settlement/pay — pay the hand-over via UPI ──
export async function startSettlementPayment(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const rider = await resolveRider(req.user.id);
    const outstanding = await getRiderOutstanding(rider.id);
    if (outstanding.handOver <= 0 || outstanding.paymentIds.length === 0) {
      throw new BadRequestError("Nothing to settle right now", "ERR_NOTHING_TO_SETTLE");
    }

    const provider = getPaymentProvider();
    if (provider.name === "simulated" && process.env.NODE_ENV === "production") {
      throw new ConflictError(
        "UPI settlement is launching soon — please hand the cash to your admin for now.",
        "ERR_PAYMENTS_UNAVAILABLE",
      );
    }

    const [settlement] = await db
      .insert(riderSettlements)
      .values({
        riderId: rider.id,
        amount: outstanding.handOver,
        cashCollected: outstanding.cashInHand,
        method: "UPI",
        status: "PENDING",
        coveredPaymentIds: outstanding.paymentIds,
        provider: provider.name,
        createdBy: "RIDER",
      })
      .returning();

    const created = await provider.createPayment({
      paymentId: settlement.id,
      orderId: settlement.id,
      amount: outstanding.handOver,
      redirectUrl: `${process.env.PAYMENT_REDIRECT_URL ?? "https://rinzo.app"}/payment-done`,
    });

    await db
      .update(riderSettlements)
      .set({ providerOrderId: created.providerOrderId })
      .where(eq(riderSettlements.id, settlement.id));

    res.json({ settlementId: settlement.id, checkoutUrl: created.checkoutUrl });
  } catch (err) {
    next(err);
  }
}

// ── GET /api/rider/settlement/:id/status — poll the UPI settlement ──
export async function checkSettlementStatus(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const rider = await resolveRider(req.user.id);
    const settlementId = req.params.id as string;

    const [settlement] = await db
      .select()
      .from(riderSettlements)
      .where(eq(riderSettlements.id, settlementId))
      .limit(1);
    if (!settlement) throw new NotFoundError("Settlement not found", "ERR_SETTLEMENT_NOT_FOUND");
    if (settlement.riderId !== rider.id) {
      throw new ForbiddenError("Not your settlement", "ERR_NOT_YOUR_SETTLEMENT");
    }

    if (settlement.status === "PAID" || !settlement.providerOrderId) {
      res.json({ status: settlement.status });
      return;
    }

    const provider = getPaymentProvider();
    const providerStatus = await provider.getStatus(settlement.providerOrderId);

    if (providerStatus === "SUCCESS") {
      await db.transaction(async (tx) => {
        const [row] = await tx
          .update(riderSettlements)
          .set({ status: "PAID", paidAt: new Date() })
          .where(and(eq(riderSettlements.id, settlementId), eq(riderSettlements.status, "PENDING")))
          .returning();
        // Close the covered COD payments (idempotent; only still-collected ones).
        if (row) {
          await settlePaymentsInTx(tx, (settlement.coveredPaymentIds as string[]) ?? []);
        }
      });
      res.json({ status: "PAID" });
      return;
    }

    res.json({ status: providerStatus === "FAILED" ? "FAILED" : "PENDING" });
  } catch (err) {
    next(err);
  }
}
