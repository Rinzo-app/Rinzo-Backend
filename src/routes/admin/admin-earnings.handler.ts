import type { Response, NextFunction } from "express";
import { eq, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { ledgerEntries } from "../../db/schema/ledger-entries.js";
import type { AuthenticatedRequest } from "../../lib/types.js";

// ─────────────────────────────────────────────────────────
// GET /api/admin/earnings
//
// ADMIN only. Platform-wide earnings summary aggregated
// from ledger_entries.  Returns:
//   - platformFees   (sum of PLATFORM_FEE entries)
//   - commissions    (sum of COMMISSION entries)
//   - shopEarnings   (sum of SHOP / EARNING entries)
//   - orderCount     (distinct orders in ledger)
// ─────────────────────────────────────────────────────────

export async function getAdminEarnings(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // ── 1. Platform totals (PLATFORM_FEE + COMMISSION) ────
    const platformRows = await db
      .select({
        reason: ledgerEntries.reason,
        total: sql<number>`coalesce(sum(${ledgerEntries.amount}), 0)::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.entityType, "PLATFORM"))
      .groupBy(ledgerEntries.reason);

    let platformFees = 0;
    let commissions = 0;
    let orderCount = 0;

    for (const row of platformRows) {
      if (row.reason === "PLATFORM_FEE") {
        platformFees = row.total;
        orderCount = row.count; // one PLATFORM_FEE per order
      } else if (row.reason === "COMMISSION") {
        commissions = row.total;
      }
    }

    // ── 2. Total shop earnings ────────────────────────────
    const [shopRow] = await db
      .select({
        total: sql<number>`coalesce(sum(${ledgerEntries.amount}), 0)::int`,
      })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.entityType, "SHOP"));

    const shopEarnings = shopRow?.total ?? 0;

    // ── 3. Respond ────────────────────────────────────────
    res.status(200).json({
      platformFees,
      commissions,
      platformTotal: platformFees + commissions,
      shopEarnings,
      orderCount,
    });
  } catch (err) {
    next(err);
  }
}
