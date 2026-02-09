import type { Response, NextFunction } from "express";
import { eq, and, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { riders } from "../../db/schema/riders.js";
import { ledgerEntries } from "../../db/schema/ledger-entries.js";
import { adminEvents } from "../../db/schema/admin-events.js";
import type { AuthenticatedRequest } from "../../lib/types.js";
import { NotFoundError, BadRequestError } from "../../lib/errors.js";

// ── Validation ─────────────────────────────────────────

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

const payoutBodySchema = z.object({
  amount: z.number().int().positive("amount must be a positive integer (paise)"),
  method: z.enum(["CASH", "BANK", "UPI"]),
  note: z.string().max(500).optional(),
  from: z.string().regex(dateRegex, "from must be YYYY-MM-DD").optional(),
  to: z.string().regex(dateRegex, "to must be YYYY-MM-DD").optional(),
});

// ── POST /api/admin/riders/:id/payout ──────────────────

export async function markRiderPayout(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const riderId = req.params.id as string;
    const adminId = req.user.id;

    // ── Validate body ───────────────────────────────────
    const parsed = payoutBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError(
        parsed.error.errors.map((e) => e.message).join("; "),
        "ERR_INVALID_PAYOUT_BODY",
      );
    }
    const { amount, method, note, from, to } = parsed.data;

    // ── Verify rider exists and is eligible ─────────────
    const [rider] = await db
      .select({ id: riders.id, status: riders.status })
      .from(riders)
      .where(eq(riders.id, riderId))
      .limit(1);

    if (!rider) {
      throw new NotFoundError("Rider not found", "ERR_RIDER_NOT_FOUND");
    }

    if (rider.status !== "ACTIVE" && rider.status !== "SUSPENDED") {
      throw new BadRequestError(
        `Rider status is ${rider.status}; must be ACTIVE or SUSPENDED for payout`,
        "ERR_RIDER_NOT_ELIGIBLE",
      );
    }

    // ── Transactional insert ────────────────────────────
    const result = await db.transaction(async (tx) => {
      // 1. Append negative ledger entry
      const [entry] = await tx
        .insert(ledgerEntries)
        .values({
          entityType: "RIDER",
          entityId: riderId,
          orderId: null,
          amount: -Math.abs(amount),
          reason: "PAYOUT",
          details: {
            method,
            note: note ?? null,
            from: from ?? null,
            to: to ?? null,
          },
        })
        .returning();

      // 2. Audit event
      await tx.insert(adminEvents).values({
        adminId,
        action: "MARK_RIDER_PAYOUT",
        targetType: "RIDER",
        targetId: riderId,
        details: {
          ledgerEntryId: entry.id,
          amount,
          method,
          note: note ?? null,
          from: from ?? null,
          to: to ?? null,
        },
      });

      return entry;
    });

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

// ── GET /api/admin/riders/:id/balance ──────────────────

export async function getRiderBalance(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const riderId = req.params.id as string;

    // ── Verify rider exists ─────────────────────────────
    const [rider] = await db
      .select({ id: riders.id })
      .from(riders)
      .where(eq(riders.id, riderId))
      .limit(1);

    if (!rider) {
      throw new NotFoundError("Rider not found", "ERR_RIDER_NOT_FOUND");
    }

    // ── Aggregate from ledger ───────────────────────────
    const [agg] = await db
      .select({
        totalEarnings: sql<number>`COALESCE(SUM(CASE WHEN ${ledgerEntries.reason} = 'EARNING' AND ${ledgerEntries.amount} > 0 THEN ${ledgerEntries.amount} ELSE 0 END), 0)`,
        totalPaidOut: sql<number>`COALESCE(SUM(CASE WHEN ${ledgerEntries.reason} = 'PAYOUT' THEN ABS(${ledgerEntries.amount}) ELSE 0 END), 0)`,
      })
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.entityType, "RIDER"),
          eq(ledgerEntries.entityId, riderId),
        ),
      );

    const totalEarnings = Number(agg.totalEarnings);
    const totalPaidOut = Number(agg.totalPaidOut);

    res.status(200).json({
      totalEarnings,
      totalPaidOut,
      balance: totalEarnings - totalPaidOut,
    });
  } catch (err) {
    next(err);
  }
}
