import type { Response, NextFunction } from "express";
import { and, eq, desc, sql, inArray } from "drizzle-orm";
import { db } from "../../db/client.js";
import { riders } from "../../db/schema/riders.js";
import { users } from "../../db/schema/users.js";
import { orders } from "../../db/schema/orders.js";
import { payments } from "../../db/schema/payments.js";
import { riderSettlements } from "../../db/schema/rider-settlements.js";
import { adminEvents } from "../../db/schema/admin-events.js";
import type { AuthenticatedRequest } from "../../lib/types.js";
import { BadRequestError, NotFoundError } from "../../lib/errors.js";
import { parseUUID } from "../../lib/validate-uuid.js";
import { getRiderOutstanding, settlePaymentsInTx } from "../../lib/rider-settlement.js";

// ─────────────────────────────────────────────────────────
// GET /api/admin/settlements
// Riders who currently hold unsettled COD cash + recent settlements.
// ─────────────────────────────────────────────────────────
export async function listSettlements(
  _req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // Riders with at least one COLLECTED COD payment outstanding.
    const riderRows = await db
      .selectDistinct({ riderId: orders.riderId })
      .from(payments)
      .innerJoin(orders, eq(orders.id, payments.orderId))
      .where(and(eq(payments.status, "COLLECTED"), eq(payments.method, "COD")));

    const riderIds = riderRows.map((r) => r.riderId).filter((x): x is string => !!x);

    const outstanding: any[] = [];
    if (riderIds.length > 0) {
      const names = await db
        .select({ riderId: riders.id, userId: riders.userId, name: users.name, phone: users.phone })
        .from(riders)
        .innerJoin(users, eq(users.id, riders.userId))
        .where(inArray(riders.id, riderIds));
      const infoByRider = new Map(names.map((n) => [n.riderId, n]));

      for (const riderId of riderIds) {
        const o = await getRiderOutstanding(riderId);
        if (o.cashInHand <= 0) continue;
        const info = infoByRider.get(riderId);
        outstanding.push({
          riderId,
          userId: info?.userId ?? null, // settle endpoint takes the user id
          name: info?.name ?? "Rider",
          phone: info?.phone ?? null,
          cashInHand: o.cashInHand,
          yourCut: o.yourCut,
          handOver: o.handOver,
          orderCount: o.orderCount,
        });
      }
    }

    const recent = await db
      .select()
      .from(riderSettlements)
      .orderBy(desc(riderSettlements.createdAt))
      .limit(50);

    res.json({ outstanding, recent });
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────
// POST /api/admin/riders/:id/settle
// Record a cash hand-over: settle ALL the rider's collected COD at once.
// :id is the rider's USER id (matches other admin rider endpoints).
// ─────────────────────────────────────────────────────────
export async function settleRiderCash(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const targetUserId = parseUUID(req.params.id as string, "user ID");

    const [rider] = await db
      .select({ id: riders.id })
      .from(riders)
      .where(eq(riders.userId, targetUserId))
      .limit(1);
    if (!rider) throw new NotFoundError("Rider not found", "ERR_RIDER_NOT_FOUND");

    const outstanding = await getRiderOutstanding(rider.id);
    if (outstanding.paymentIds.length === 0) {
      throw new BadRequestError("This rider has no cash to settle", "ERR_NOTHING_TO_SETTLE");
    }

    const settlement = await db.transaction(async (tx) => {
      await settlePaymentsInTx(tx, outstanding.paymentIds);
      const [row] = await tx
        .insert(riderSettlements)
        .values({
          riderId: rider.id,
          amount: outstanding.handOver,
          cashCollected: outstanding.cashInHand,
          method: "CASH",
          status: "PAID",
          coveredPaymentIds: outstanding.paymentIds,
          createdBy: "ADMIN",
          verifiedBy: req.user.id,
          paidAt: new Date(),
        })
        .returning();

      await tx.insert(adminEvents).values({
        adminId: req.user.id,
        action: "SETTLE_RIDER_CASH",
        targetType: "USER",
        targetId: targetUserId,
        details: { amount: outstanding.handOver, orderCount: outstanding.orderCount },
      });
      return row;
    });

    res.json({ ok: true, settlement });
  } catch (err) {
    next(err);
  }
}
