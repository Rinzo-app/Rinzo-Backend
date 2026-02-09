import type { Response, NextFunction } from "express";
import { eq, and, SQL } from "drizzle-orm";
import { db } from "../../db/client.js";
import { users } from "../../db/schema/users.js";
import { riders } from "../../db/schema/riders.js";
import { shops } from "../../db/schema/shops.js";
import { adminEvents } from "../../db/schema/admin-events.js";
import type { AuthenticatedRequest } from "../../lib/types.js";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from "../../lib/errors.js";

// ── Valid user‑level status transitions ──────────────────
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  PENDING: ["ACTIVE", "SUSPENDED"],          // approve → ACTIVE, reject → SUSPENDED
  ACTIVE: ["SUSPENDED"],                      // suspend
  SUSPENDED: ["ACTIVE"],                      // re‑enable
};

// ── Derived status for related tables ────────────────────
// Maps user-status actions to rider/shop status values.
function riderStatusFor(userStatus: string): string {
  if (userStatus === "ACTIVE") return "APPROVED";
  if (userStatus === "SUSPENDED") return "SUSPENDED";
  return "PENDING";
}

function shopStatusFor(userStatus: string): string {
  if (userStatus === "ACTIVE") return "APPROVED";
  if (userStatus === "SUSPENDED") return "SUSPENDED";
  return "PENDING";
}

// ─────────────────────────────────────────────────────────
// GET /api/admin/users?status=PENDING&role=SHOP_OWNER
// ─────────────────────────────────────────────────────────
export async function listUsers(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const conditions: SQL[] = [];

    const statusParam = req.query.status as string | undefined;
    if (statusParam) {
      const allowed = ["PENDING", "ACTIVE", "SUSPENDED"];
      if (!allowed.includes(statusParam)) {
        throw new BadRequestError(`Invalid status filter: ${statusParam}`);
      }
      conditions.push(eq(users.status, statusParam as "PENDING" | "ACTIVE" | "SUSPENDED"));
    }

    const roleParam = req.query.role as string | undefined;
    if (roleParam) {
      const allowed = ["CUSTOMER", "SHOP_OWNER", "RIDER"];
      if (!allowed.includes(roleParam)) {
        throw new BadRequestError(`Invalid role filter: ${roleParam}`);
      }
      conditions.push(eq(users.role, roleParam as "CUSTOMER" | "SHOP_OWNER" | "RIDER" | "ADMIN"));
    }

    const rows =
      conditions.length > 0
        ? await db.select().from(users).where(and(...conditions))
        : await db.select().from(users);

    res.json(rows);
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────
// POST /api/admin/users/:id/approve
// ─────────────────────────────────────────────────────────
export async function approveUser(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const targetId = req.params.id as string;
    assertNotSelf(req.user.id, targetId);

    const user = await loadUser(targetId);
    assertTransition(user.status, "ACTIVE");

    const [updated] = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(users)
        .set({ status: "ACTIVE" })
        .where(eq(users.id, targetId))
        .returning();

      await syncRelatedStatus(tx, row.role, row.id, "ACTIVE");

      await tx.insert(adminEvents).values({
        adminId: req.user.id,
        action: "APPROVE_USER",
        targetType: "USER",
        targetId,
        details: { previousStatus: user.status, role: row.role },
      });

      return [row];
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────
// POST /api/admin/users/:id/reject
// ─────────────────────────────────────────────────────────
export async function rejectUser(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const targetId = req.params.id as string;
    assertNotSelf(req.user.id, targetId);

    const user = await loadUser(targetId);
    // Reject is only valid from PENDING
    if (user.status !== "PENDING") {
      throw new BadRequestError(
        `Cannot reject a user with status ${user.status}`,
      );
    }

    const [updated] = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(users)
        .set({ status: "SUSPENDED" })
        .where(eq(users.id, targetId))
        .returning();

      await syncRelatedStatus(tx, row.role, row.id, "SUSPENDED");

      await tx.insert(adminEvents).values({
        adminId: req.user.id,
        action: "REJECT_USER",
        targetType: "USER",
        targetId,
        details: { previousStatus: user.status, role: row.role },
      });

      return [row];
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────
// POST /api/admin/users/:id/suspend
// ─────────────────────────────────────────────────────────
export async function suspendUser(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const targetId = req.params.id as string;
    assertNotSelf(req.user.id, targetId);

    const user = await loadUser(targetId);
    assertTransition(user.status, "SUSPENDED");

    const [updated] = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(users)
        .set({ status: "SUSPENDED" })
        .where(eq(users.id, targetId))
        .returning();

      await syncRelatedStatus(tx, row.role, row.id, "SUSPENDED");

      await tx.insert(adminEvents).values({
        adminId: req.user.id,
        action: "SUSPEND_USER",
        targetType: "USER",
        targetId,
        details: { previousStatus: user.status, role: row.role },
      });

      return [row];
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
}

// ── Internal helpers ─────────────────────────────────────

async function loadUser(id: string) {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  if (!user) throw new NotFoundError("User not found");
  if (user.role === "ADMIN") {
    throw new BadRequestError("Cannot manage ADMIN users through this endpoint");
  }
  return user;
}

function assertNotSelf(actorId: string, targetId: string) {
  if (actorId === targetId) {
    throw new ConflictError("Cannot modify your own account");
  }
}

function assertTransition(currentStatus: string, targetStatus: string) {
  const allowed = ALLOWED_TRANSITIONS[currentStatus];
  if (!allowed || !allowed.includes(targetStatus)) {
    throw new BadRequestError(
      `Cannot transition from ${currentStatus} to ${targetStatus}`,
    );
  }
}

/** Propagate user.status change to riders / shops table. */
async function syncRelatedStatus(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  role: string,
  userId: string,
  userStatus: string,
) {
  if (role === "RIDER") {
    await tx
      .update(riders)
      .set({ status: riderStatusFor(userStatus) as any })
      .where(eq(riders.userId, userId));
  } else if (role === "SHOP_OWNER") {
    await tx
      .update(shops)
      .set({ status: shopStatusFor(userStatus) as any })
      .where(eq(shops.ownerId, userId));
  }
}
