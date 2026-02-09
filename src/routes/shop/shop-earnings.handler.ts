import type { Response, NextFunction } from "express";
import { eq, and, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { shops } from "../../db/schema/shops.js";
import { ledgerEntries } from "../../db/schema/ledger-entries.js";
import type { AuthenticatedRequest } from "../../lib/types.js";
import { NotFoundError } from "../../lib/errors.js";

// ─────────────────────────────────────────────────────────
// GET /api/shop/earnings
//
// SHOP_OWNER only. Returns aggregate earnings across all
// shops owned by the authenticated user, plus a per-shop
// breakdown.  Source of truth: ledger_entries only.
// ─────────────────────────────────────────────────────────

export async function getShopEarnings(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ownerId = req.user.id;

    // ── 1. Resolve shops owned by this user ────────────────
    const ownerShops = await db
      .select({ id: shops.id, name: shops.name })
      .from(shops)
      .where(eq(shops.ownerId, ownerId));

    if (ownerShops.length === 0) {
      throw new NotFoundError(
        "No shops found for this user",
        "ERR_NO_SHOPS",
      );
    }

    const shopIds = ownerShops.map((s) => s.id);

    // ── 2. Aggregate per shop ──────────────────────────────
    const rows = await db
      .select({
        entityId: ledgerEntries.entityId,
        reason: ledgerEntries.reason,
        total: sql<number>`coalesce(sum(${ledgerEntries.amount}), 0)::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.entityType, "SHOP"),
          sql`${ledgerEntries.entityId} = ANY(${shopIds})`,
        ),
      )
      .groupBy(ledgerEntries.entityId, ledgerEntries.reason);

    // ── 3. Shape response ──────────────────────────────────
    const shopMap = new Map(ownerShops.map((s) => [s.id, s.name]));
    const perShop: Record<string, { shopName: string; totalEarnings: number; orderCount: number }> = {};

    for (const row of rows) {
      const sid = row.entityId!;
      if (!perShop[sid]) {
        perShop[sid] = {
          shopName: shopMap.get(sid) ?? sid,
          totalEarnings: 0,
          orderCount: 0,
        };
      }
      if (row.reason === "EARNING") {
        perShop[sid].totalEarnings = row.total;
        perShop[sid].orderCount = row.count;
      }
    }

    const totalEarnings = Object.values(perShop).reduce(
      (sum, s) => sum + s.totalEarnings,
      0,
    );
    const totalOrders = Object.values(perShop).reduce(
      (sum, s) => sum + s.orderCount,
      0,
    );

    res.status(200).json({
      totalEarnings,
      totalOrders,
      shops: Object.entries(perShop).map(([shopId, data]) => ({
        shopId,
        ...data,
      })),
    });
  } catch (err) {
    next(err);
  }
}
