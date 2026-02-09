import type { Response, NextFunction } from "express";
import { eq, and, gt, gte, lte } from "drizzle-orm";
import { db } from "../../db/client.js";
import { ledgerEntries } from "../../db/schema/ledger-entries.js";
import { riders } from "../../db/schema/riders.js";
import { users } from "../../db/schema/users.js";
import type { AuthenticatedRequest } from "../../lib/types.js";

// ── Response shapes ────────────────────────────────────

interface AdminRiderEntry {
  date: string;
  leg: "PICKUP" | "DROP";
  amount: number;
  distanceKm: number;
  distanceSource: string;
  ratePerKm: number;
  orderId: string;
  createdAt: string;
}

interface AdminRiderSummary {
  riderId: string;
  riderName: string;
  totalEarnings: number;
  totalDistanceKm: number;
  totalLegs: number;
  earnings: AdminRiderEntry[];
}

interface AdminRiderEarningsResponse {
  totalRiders: number;
  totalAmount: number;
  riders: AdminRiderSummary[];
}

// ── GET /api/admin/rider-earnings ──────────────────────

export async function getAdminRiderEarnings(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { riderId, from, to } = req.query as {
      riderId?: string;
      from?: string;
      to?: string;
    };

    // ── Build WHERE conditions ──────────────────────────
    const conditions = [
      eq(ledgerEntries.entityType, "RIDER"),
      eq(ledgerEntries.reason, "EARNING"),
      gt(ledgerEntries.amount, 0),
    ];

    if (riderId && typeof riderId === "string") {
      conditions.push(eq(ledgerEntries.entityId, riderId));
    }

    if (from && typeof from === "string") {
      // Start of day UTC
      conditions.push(gte(ledgerEntries.createdAt, new Date(`${from}T00:00:00.000Z`)));
    }

    if (to && typeof to === "string") {
      // End of day UTC (inclusive)
      conditions.push(lte(ledgerEntries.createdAt, new Date(`${to}T23:59:59.999Z`)));
    }

    // ── Fetch ledger rows with rider + user info ────────
    const rows = await db
      .select({
        orderId: ledgerEntries.orderId,
        entityId: ledgerEntries.entityId,
        amount: ledgerEntries.amount,
        details: ledgerEntries.details,
        createdAt: ledgerEntries.createdAt,
        riderUserId: riders.userId,
        userName: users.name,
      })
      .from(ledgerEntries)
      .innerJoin(riders, eq(ledgerEntries.entityId, riders.id))
      .innerJoin(users, eq(riders.userId, users.id))
      .where(and(...conditions))
      .orderBy(ledgerEntries.createdAt);

    // ── Group by rider ──────────────────────────────────
    const riderMap = new Map<
      string,
      { name: string; totalEarnings: number; totalDistanceKm: number; entries: AdminRiderEntry[] }
    >();

    for (const row of rows) {
      const rid = row.entityId!; // non-null (RIDER entries always have entityId)

      const d = row.details as {
        leg?: string;
        distanceKm?: number;
        ratePerKm?: number;
        distanceSource?: string;
      } | null;

      const distanceKm = typeof d?.distanceKm === "number" ? d.distanceKm : 0;
      const ratePerKm = typeof d?.ratePerKm === "number" ? d.ratePerKm : 0;
      const leg = (d?.leg === "PICKUP" || d?.leg === "DROP" ? d.leg : "PICKUP") as "PICKUP" | "DROP";
      const distanceSource = typeof d?.distanceSource === "string" ? d.distanceSource : "UNKNOWN";

      const entry: AdminRiderEntry = {
        date: row.createdAt.toISOString().slice(0, 10),
        leg,
        amount: row.amount,
        distanceKm: Math.round(distanceKm * 100) / 100,
        distanceSource,
        ratePerKm,
        orderId: row.orderId ?? "",
        createdAt: row.createdAt.toISOString(),
      };

      let riderData = riderMap.get(rid);
      if (!riderData) {
        riderData = { name: row.userName, totalEarnings: 0, totalDistanceKm: 0, entries: [] };
        riderMap.set(rid, riderData);
      }
      riderData.totalEarnings += row.amount;
      riderData.totalDistanceKm += distanceKm;
      riderData.entries.push(entry);
    }

    // ── Build response ──────────────────────────────────
    let totalAmount = 0;
    const riderSummaries: AdminRiderSummary[] = [];

    for (const [rid, data] of riderMap) {
      totalAmount += data.totalEarnings;
      // Entries are ASC from query — reverse to newest-first
      data.entries.reverse();
      riderSummaries.push({
        riderId: rid,
        riderName: data.name,
        totalEarnings: data.totalEarnings,
        totalDistanceKm: Math.round(data.totalDistanceKm * 100) / 100,
        totalLegs: data.entries.length,
        earnings: data.entries,
      });
    }

    // Sort riders by totalEarnings DESC
    riderSummaries.sort((a, b) => b.totalEarnings - a.totalEarnings);

    const body: AdminRiderEarningsResponse = {
      totalRiders: riderSummaries.length,
      totalAmount,
      riders: riderSummaries,
    };

    res.status(200).json(body);
  } catch (err) {
    next(err);
  }
}
