import type { Response, NextFunction } from "express";
import { eq, and, desc, SQL } from "drizzle-orm";
import { db } from "../../db/client.js";
import { disputes } from "../../db/schema/disputes.js";
import { users } from "../../db/schema/users.js";
import type { AuthenticatedRequest } from "../../lib/types.js";
import { BadRequestError, NotFoundError } from "../../lib/errors.js";

// ── Valid dispute-status transitions (forward-only) ──────
const VALID_STATUSES = ["OPEN", "IN_REVIEW", "RESOLVED", "CLOSED"] as const;
type DisputeStatus = (typeof VALID_STATUSES)[number];

// ─────────────────────────────────────────────────────────
// GET /api/admin/disputes?status=...&raisedByType=...
// Returns all disputes joined with the user who raised them
// so the response includes `raisedByName`.
// ─────────────────────────────────────────────────────────
export async function listDisputes(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const conditions: SQL[] = [];

    const statusParam = req.query.status as string | undefined;
    if (statusParam) {
      if (!VALID_STATUSES.includes(statusParam as DisputeStatus)) {
        throw new BadRequestError(`Invalid status filter: ${statusParam}`);
      }
      conditions.push(eq(disputes.status, statusParam as DisputeStatus));
    }

    const raisedByTypeParam = req.query.raisedByType as string | undefined;
    if (raisedByTypeParam) {
      const allowed = ["CUSTOMER", "SHOP", "RIDER"];
      if (!allowed.includes(raisedByTypeParam)) {
        throw new BadRequestError(
          `Invalid raisedByType filter: ${raisedByTypeParam}`,
        );
      }
      conditions.push(
        eq(
          disputes.raisedByType,
          raisedByTypeParam as "CUSTOMER" | "SHOP" | "RIDER",
        ),
      );
    }

    // Left-join with users to resolve raisedById → name
    const baseQuery = db
      .select({
        id: disputes.id,
        raisedByType: disputes.raisedByType,
        raisedById: disputes.raisedById,
        raisedByName: users.name,
        orderId: disputes.orderId,
        category: disputes.category,
        description: disputes.description,
        status: disputes.status,
        internalNotes: disputes.adminNotes,
        createdAt: disputes.createdAt,
      })
      .from(disputes)
      .leftJoin(users, eq(disputes.raisedById, users.id))
      .orderBy(desc(disputes.createdAt));

    const rows =
      conditions.length > 0
        ? await baseQuery.where(and(...conditions))
        : await baseQuery;

    // Normalise nulls from the left-join
    const mapped = rows.map((r) => ({
      ...r,
      raisedByName: r.raisedByName ?? "Unknown",
    }));

    res.json(mapped);
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────
// PATCH /api/admin/disputes/:id
// Body: { status, internalNotes? }
// ─────────────────────────────────────────────────────────
export async function updateDispute(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = req.params.id as string;

    const { status, internalNotes } = req.body as {
      status?: string;
      internalNotes?: string;
    };

    if (status && !VALID_STATUSES.includes(status as DisputeStatus)) {
      throw new BadRequestError(`Invalid status: ${status}`);
    }

    // Build the SET object dynamically so we only touch fields provided
    const updates: Record<string, unknown> = {};
    if (status) updates.status = status;
    if (internalNotes !== undefined) updates.adminNotes = internalNotes;

    if (Object.keys(updates).length === 0) {
      throw new BadRequestError("Nothing to update");
    }

    const [updated] = await db
      .update(disputes)
      .set(updates)
      .where(eq(disputes.id, id))
      .returning();

    if (!updated) {
      throw new NotFoundError("Dispute not found");
    }

    // Return the same shape as listDisputes for cache consistency
    const [row] = await db
      .select({
        id: disputes.id,
        raisedByType: disputes.raisedByType,
        raisedById: disputes.raisedById,
        raisedByName: users.name,
        orderId: disputes.orderId,
        category: disputes.category,
        description: disputes.description,
        status: disputes.status,
        internalNotes: disputes.adminNotes,
        createdAt: disputes.createdAt,
      })
      .from(disputes)
      .leftJoin(users, eq(disputes.raisedById, users.id))
      .where(eq(disputes.id, id));

    res.json({
      ...row,
      raisedByName: row?.raisedByName ?? "Unknown",
    });
  } catch (err) {
    next(err);
  }
}
