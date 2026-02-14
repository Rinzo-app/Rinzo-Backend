import type { Response, NextFunction } from "express";
import { eq, and, desc, sql, SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { paginationSchema, paginate, paginatedResponse } from "../../lib/pagination.js";
import { disputes } from "../../db/schema/disputes.js";
import { users } from "../../db/schema/users.js";
import type { AuthenticatedRequest } from "../../lib/types.js";
import { BadRequestError, NotFoundError } from "../../lib/errors.js";
import { parseUUID } from "../../lib/validate-uuid.js";

// ── Valid dispute-status transitions (forward-only) ──────
const VALID_STATUSES = ["OPEN", "IN_REVIEW", "RESOLVED", "CLOSED"] as const;
type DisputeStatus = (typeof VALID_STATUSES)[number];

// Forward-only transition map
const VALID_TRANSITIONS: Record<DisputeStatus, readonly DisputeStatus[]> = {
  OPEN: ["IN_REVIEW"],
  IN_REVIEW: ["RESOLVED", "CLOSED"],
  RESOLVED: ["CLOSED"],
  CLOSED: [],
};

// ── Zod schema for PATCH body ────────────────────────────
const updateDisputeSchema = z.object({
  status: z.enum(VALID_STATUSES).optional(),
  internalNotes: z.string().max(2000).optional(),  resolution: z.string().max(2000).optional(),});

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
    const { page, limit } = paginationSchema.parse(req.query);
    const { offset } = paginate(page, limit);

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [{ count: total }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(disputes)
      .where(whereClause);

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
        resolution: disputes.resolution,
        createdAt: disputes.createdAt,
        updatedAt: disputes.updatedAt,
      })
      .from(disputes)
      .leftJoin(users, eq(disputes.raisedById, users.id))
      .orderBy(desc(disputes.createdAt))
      .limit(limit)
      .offset(offset);

    const rows = whereClause
      ? await baseQuery.where(whereClause)
      : await baseQuery;

    // Normalise nulls from the left-join
    const mapped = rows.map((r) => ({
      ...r,
      raisedByName: r.raisedByName ?? "Unknown",
    }));

    res.json(paginatedResponse(mapped, total, page, limit));
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────
// PATCH /api/admin/disputes/:id
// Body: { status?, internalNotes? }
// ─────────────────────────────────────────────────────────
export async function updateDispute(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = parseUUID(req.params.id as string, "dispute ID");

    // ── Validate body with Zod ────────────────────────────
    const parsed = updateDisputeSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError(
        parsed.error.errors.map((e) => e.message).join("; "),
      );
    }
    const { status, internalNotes, resolution } = parsed.data;

    // ── Fetch current dispute (needed for transition check) ─
    const [current] = await db
      .select({ id: disputes.id, status: disputes.status })
      .from(disputes)
      .where(eq(disputes.id, id))
      .limit(1);

    if (!current) {
      throw new NotFoundError("Dispute not found");
    }

    // ── Enforce forward-only transition ───────────────────
    if (status) {
      const currentStatus = current.status as DisputeStatus;
      const allowed = VALID_TRANSITIONS[currentStatus];
      if (!allowed || !allowed.includes(status)) {
        throw new BadRequestError(
          `Cannot transition from ${currentStatus} to ${status}. Allowed: ${allowed?.join(", ") || "none"}`,
        );
      }
    }

    // Build the SET object dynamically so we only touch fields provided
    const updates: Record<string, unknown> = {};
    if (status) updates.status = status;
    if (internalNotes !== undefined) updates.adminNotes = internalNotes;
    if (resolution !== undefined) updates.resolution = resolution;
    // Always set updatedAt on any change
    updates.updatedAt = new Date();

    if (Object.keys(updates).length === 0) {
      throw new BadRequestError("Nothing to update");
    }

    await db
      .update(disputes)
      .set(updates)
      .where(eq(disputes.id, id));

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
        resolution: disputes.resolution,
        createdAt: disputes.createdAt,
        updatedAt: disputes.updatedAt,
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
