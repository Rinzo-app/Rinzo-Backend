import type { Response, NextFunction } from "express";
import { and, eq, gte, isNull, sql, inArray } from "drizzle-orm";
import { db } from "../../db/client.js";
import { orders } from "../../db/schema/orders.js";
import { payments } from "../../db/schema/payments.js";
import { riders } from "../../db/schema/riders.js";
import { shops } from "../../db/schema/shops.js";
import { users } from "../../db/schema/users.js";
import { disputes } from "../../db/schema/disputes.js";
import { ledgerEntries } from "../../db/schema/ledger-entries.js";
import type { AuthenticatedRequest } from "../../lib/types.js";

// ─────────────────────────────────────────────────────────
// GET /api/admin/dashboard
//
// ADMIN only. At-a-glance platform metrics for the dashboard:
// orders (today / total / active), revenue, COD outstanding,
// riders online, shops, disputes, and a 7-day order series.
// ─────────────────────────────────────────────────────────

const ACTIVE_ORDER_STATUSES = [
  "PLACED",
  "SHOP_ACCEPTED",
  "PICKUP_OFFERED",
  "PICKUP_ASSIGNED",
  "PICKED_UP_FROM_CUSTOMER",
  "AT_SHOP",
  "READY",
  "DELIVERY_OFFERED",
  "OUT_FOR_DELIVERY",
] as const;

// Riders busy on a leg right now.
const RIDER_BUSY_STATUSES = [
  "PICKUP_OFFERED",
  "PICKUP_ASSIGNED",
  "PICKED_UP_FROM_CUSTOMER",
  "DELIVERY_OFFERED",
  "OUT_FOR_DELIVERY",
] as const;

/** Start of "today" in IST, as a Date (timestamps are stored UTC-ish). */
function istTodayStart(): Date {
  const IST = 5.5 * 60 * 60 * 1000;
  const nowIst = new Date(Date.now() + IST);
  const midnightIstUtc = Date.UTC(
    nowIst.getUTCFullYear(),
    nowIst.getUTCMonth(),
    nowIst.getUTCDate(),
  );
  return new Date(midnightIstUtc - IST);
}

export async function getDashboard(
  _req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const todayStart = istTodayStart();

    const [
      orderTotals,
      ordersTodayRow,
      activeRow,
      gmvRow,
      platformRows,
      codRow,
      ridersActiveRow,
      ridersOnlineRow,
      ridersBusyRow,
      shopRows,
      customerRow,
      disputeRow,
      dailyRows,
    ] = await Promise.all([
      db.select({ c: sql<number>`count(*)::int` }).from(orders),
      db
        .select({ c: sql<number>`count(*)::int` })
        .from(orders)
        .where(gte(orders.createdAt, todayStart)),
      db
        .select({ c: sql<number>`count(*)::int` })
        .from(orders)
        .where(inArray(orders.status, [...ACTIVE_ORDER_STATUSES])),
      db
        .select({ total: sql<number>`coalesce(sum(${orders.totalAmount}),0)::int` })
        .from(orders)
        .where(eq(orders.status, "DELIVERED")),
      db
        .select({
          reason: ledgerEntries.reason,
          total: sql<number>`coalesce(sum(${ledgerEntries.amount}),0)::int`,
        })
        .from(ledgerEntries)
        .where(eq(ledgerEntries.entityType, "PLATFORM"))
        .groupBy(ledgerEntries.reason),
      db
        .select({ total: sql<number>`coalesce(sum(${payments.amount}),0)::int` })
        .from(payments)
        .where(and(eq(payments.method, "COD"), eq(payments.status, "COLLECTED"))),
      db
        .select({ c: sql<number>`count(*)::int` })
        .from(riders)
        .where(eq(riders.status, "ACTIVE")),
      db
        .select({ c: sql<number>`count(*)::int` })
        .from(riders)
        .where(and(eq(riders.status, "ACTIVE"), eq(riders.isAvailable, true))),
      db
        .select({ c: sql<number>`count(distinct ${orders.riderId})::int` })
        .from(orders)
        .where(inArray(orders.status, [...RIDER_BUSY_STATUSES])),
      db
        .select({ status: shops.status, c: sql<number>`count(*)::int` })
        .from(shops)
        .groupBy(shops.status),
      db
        .select({ c: sql<number>`count(*)::int` })
        .from(users)
        .where(and(eq(users.role, "CUSTOMER"), isNull(users.deletedAt))),
      db
        .select({ c: sql<number>`count(*)::int` })
        .from(disputes)
        .where(inArray(disputes.status, [...(["OPEN", "IN_REVIEW"] as const)])),
      db.execute(sql`
        select to_char(date_trunc('day', ${orders.createdAt} + interval '330 minutes'), 'YYYY-MM-DD') as day,
               count(*)::int as orders
        from ${orders}
        where ${orders.createdAt} >= now() - interval '7 days'
        group by day
        order by day
      `),
    ]);

    let platformFees = 0;
    let commissions = 0;
    for (const r of platformRows) {
      if (r.reason === "PLATFORM_FEE") platformFees = r.total;
      else if (r.reason === "COMMISSION") commissions = r.total;
    }

    const shopsByStatus: Record<string, number> = {};
    for (const r of shopRows) shopsByStatus[r.status] = r.c;

    // db.execute returns driver-shaped rows; normalise.
    const daily = (dailyRows as unknown as { rows?: any[] }).rows ?? (dailyRows as unknown as any[]);

    res.status(200).json({
      orders: {
        total: orderTotals[0]?.c ?? 0,
        today: ordersTodayRow[0]?.c ?? 0,
        active: activeRow[0]?.c ?? 0,
      },
      revenue: {
        platformTotal: platformFees + commissions,
        platformFees,
        commissions,
        gmvDelivered: gmvRow[0]?.total ?? 0,
        codOutstanding: codRow[0]?.total ?? 0,
      },
      riders: {
        active: ridersActiveRow[0]?.c ?? 0,
        online: ridersOnlineRow[0]?.c ?? 0,
        busy: ridersBusyRow[0]?.c ?? 0,
      },
      shops: {
        approved: shopsByStatus["APPROVED"] ?? 0,
        pending: shopsByStatus["PENDING"] ?? 0,
        suspended: shopsByStatus["SUSPENDED"] ?? 0,
      },
      customers: customerRow[0]?.c ?? 0,
      disputesOpen: disputeRow[0]?.c ?? 0,
      last7Days: (daily ?? []).map((d: any) => ({
        day: d.day as string,
        orders: Number(d.orders),
      })),
    });
  } catch (err) {
    next(err);
  }
}
