import type { Response, NextFunction } from "express";
import { eq, and, gt } from "drizzle-orm";
import { db } from "../../db/client.js";
import { riders } from "../../db/schema/riders.js";
import { ledgerEntries } from "../../db/schema/ledger-entries.js";
import type { AuthenticatedRequest } from "../../lib/types.js";
import { NotFoundError } from "../../lib/errors.js";

// ── Response shapes ────────────────────────────────────
interface EarningsEntry {
  orderId: string;
  leg: "PICKUP" | "DROP";
  distanceKm: number;
  amount: number;
  ratePerKm: number;
  distanceSource: string;
  createdAt: string;
}

interface DaySummary {
  date: string; // YYYY-MM-DD
  earnings: number;
  distanceKm: number;
  legs: number;
  entries: EarningsEntry[];
}

interface EarningsResponse {
  totalEarnings: number;
  totalDistanceKm: number;
  totalLegs: number;
  days: DaySummary[];
}

// ── GET /api/rider/earnings ────────────────────────────
export async function getRiderEarnings(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // ── Resolve rider record ────────────────────────────
    const [rider] = await db
      .select({ id: riders.id })
      .from(riders)
      .where(eq(riders.userId, req.user.id))
      .limit(1);

    if (!rider) {
      throw new NotFoundError("Rider record not found");
    }

    // ── Fetch all EARNING ledger entries for this rider ─
    const rows = await db
      .select({
        orderId: ledgerEntries.orderId,
        amount: ledgerEntries.amount,
        details: ledgerEntries.details,
        createdAt: ledgerEntries.createdAt,
      })
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.entityType, "RIDER"),
          eq(ledgerEntries.entityId, rider.id),
          eq(ledgerEntries.reason, "EARNING"),
          gt(ledgerEntries.amount, 0),
        ),
      )
      .orderBy(ledgerEntries.createdAt);

    // ── Build response ──────────────────────────────────
    let totalEarnings = 0;
    let totalDistanceKm = 0;

    // Group by date (YYYY-MM-DD) preserving insertion order
    const dayMap = new Map<string, { earnings: number; distanceKm: number; entries: EarningsEntry[] }>();

    for (const row of rows) {
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

      const entry: EarningsEntry = {
        orderId: row.orderId ?? "",
        leg,
        distanceKm: Math.round(distanceKm * 100) / 100,
        amount: row.amount,
        ratePerKm,
        distanceSource,
        createdAt: row.createdAt.toISOString(),
      };

      totalEarnings += row.amount;
      totalDistanceKm += distanceKm;

      // Date key in YYYY-MM-DD (UTC)
      const dateKey = row.createdAt.toISOString().slice(0, 10);

      let day = dayMap.get(dateKey);
      if (!day) {
        day = { earnings: 0, distanceKm: 0, entries: [] };
        dayMap.set(dateKey, day);
      }
      day.earnings += row.amount;
      day.distanceKm += distanceKm;
      day.entries.push(entry);
    }

    // Build days array sorted DESC (most recent first)
    const days: DaySummary[] = [];
    for (const [date, day] of dayMap) {
      // Reverse entries within each day so newest is first
      day.entries.reverse();
      days.push({
        date,
        earnings: day.earnings,
        distanceKm: Math.round(day.distanceKm * 100) / 100,
        legs: day.entries.length,
        entries: day.entries,
      });
    }
    days.reverse(); // Map insertion order was ASC; reverse for DESC

    const body: EarningsResponse = {
      totalEarnings,
      totalDistanceKm: Math.round(totalDistanceKm * 100) / 100,
      totalLegs: rows.length,
      days,
    };

    res.status(200).json(body);
  } catch (err) {
    next(err);
  }
}
