import type { Response, NextFunction } from "express";
import { and, eq, desc, sql, inArray } from "drizzle-orm";
import { db } from "../../db/client.js";
import { riders } from "../../db/schema/riders.js";
import { users } from "../../db/schema/users.js";
import { shops } from "../../db/schema/shops.js";
import { orders } from "../../db/schema/orders.js";
import { payments } from "../../db/schema/payments.js";
import { ledgerEntries } from "../../db/schema/ledger-entries.js";
import { riderSettlements } from "../../db/schema/rider-settlements.js";
import { shopPayouts } from "../../db/schema/shop-payouts.js";
import { adminEvents } from "../../db/schema/admin-events.js";
import type { AuthenticatedRequest } from "../../lib/types.js";
import { BadRequestError, NotFoundError } from "../../lib/errors.js";
import { parseUUID } from "../../lib/validate-uuid.js";
import { getRiderOutstanding, settlePaymentsInTx } from "../../lib/rider-settlement.js";
import { getShopOutstanding } from "../../lib/shop-payout.js";

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

// ─────────────────────────────────────────────────────────
// GET /api/admin/shop-payouts
// Shops with an outstanding balance owed + recent payouts.
// ─────────────────────────────────────────────────────────
export async function listShopPayouts(
  _req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // Shops that have earned anything.
    const earners = await db
      .selectDistinct({ shopId: ledgerEntries.entityId })
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.entityType, "SHOP"), eq(ledgerEntries.reason, "EARNING")));
    const shopIds = earners.map((e) => e.shopId).filter((x): x is string => !!x);

    const outstanding: any[] = [];
    if (shopIds.length > 0) {
      const shopInfo = await db
        .select({
          id: shops.id,
          name: shops.name,
          ownerId: shops.ownerId,
          payoutMethod: shops.payoutMethod,
          bankAccountName: shops.bankAccountName,
          bankAccountNumber: shops.bankAccountNumber,
          bankIfsc: shops.bankIfsc,
          upiId: shops.upiId,
        })
        .from(shops)
        .where(inArray(shops.id, shopIds));
      const infoById = new Map(shopInfo.map((s) => [s.id, s]));

      for (const shopId of shopIds) {
        const { earned, paidOut, balance } = await getShopOutstanding(shopId);
        if (balance <= 0) continue;
        const info = infoById.get(shopId);
        outstanding.push({ shopId, ...(info ?? {}), earned, paidOut, balance });
      }
    }

    const recent = await db
      .select()
      .from(shopPayouts)
      .orderBy(desc(shopPayouts.createdAt))
      .limit(50);

    res.json({ outstanding, recent });
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────
// POST /api/admin/shops/:id/payout   (:id = shop id)
// Record a payout of the shop's current balance.
// ─────────────────────────────────────────────────────────
export async function payShop(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const shopId = parseUUID(req.params.id as string, "shop ID");
    const reference =
      typeof req.body?.reference === "string" ? req.body.reference.trim().slice(0, 120) : null;

    const [shop] = await db
      .select({ id: shops.id, payoutMethod: shops.payoutMethod })
      .from(shops)
      .where(eq(shops.id, shopId))
      .limit(1);
    if (!shop) throw new NotFoundError("Shop not found", "ERR_SHOP_NOT_FOUND");

    const { balance } = await getShopOutstanding(shopId);
    if (balance <= 0) {
      throw new BadRequestError("This shop has no balance to pay out", "ERR_NOTHING_TO_PAY");
    }

    const [payout] = await db
      .insert(shopPayouts)
      .values({
        shopId,
        amount: balance,
        method: shop.payoutMethod ?? "BANK",
        reference,
        createdBy: req.user.id,
      })
      .returning();

    await db.insert(adminEvents).values({
      adminId: req.user.id,
      action: "PAY_SHOP",
      targetType: "SHOP",
      targetId: shopId,
      details: { amount: balance, reference },
    });

    res.json({ ok: true, payout });
  } catch (err) {
    next(err);
  }
}
