import type { Response, NextFunction } from "express";
import { eq, and, inArray, sql, SQL } from "drizzle-orm";
import { db } from "../../db/client.js";
import { paginationSchema, paginate, paginatedResponse } from "../../lib/pagination.js";
import { users } from "../../db/schema/users.js";
import { riders } from "../../db/schema/riders.js";
import { shops } from "../../db/schema/shops.js";
import { orders } from "../../db/schema/orders.js";
import { orderEvents } from "../../db/schema/order-events.js";
import { adminEvents } from "../../db/schema/admin-events.js";
import type { OrderStatus } from "../../lib/order-machine.js";
import type { AuthenticatedRequest } from "../../lib/types.js";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from "../../lib/errors.js";
import { parseUUID } from "../../lib/validate-uuid.js";
import { notifyUserAsync } from "../../lib/push.js";

// ── Valid user‑level status transitions ──────────────────
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  PENDING: ["ACTIVE", "SUSPENDED"],          // approve → ACTIVE, reject → SUSPENDED
  ACTIVE: ["SUSPENDED"],                      // suspend
  SUSPENDED: ["ACTIVE"],                      // re‑enable
};

// ── Derived status for related tables ────────────────────
// Maps user-status actions to rider/shop status values.

type RiderStatus = "PENDING" | "APPROVED" | "ACTIVE" | "SUSPENDED";
type ShopStatus = "PENDING" | "APPROVED" | "REJECTED" | "SUSPENDED";

function riderStatusFor(userStatus: string): RiderStatus {
  // Approval activates the rider directly — auto-assign only
  // dispatches to riders with status ACTIVE (domain contract §5).
  if (userStatus === "ACTIVE") return "ACTIVE";
  if (userStatus === "SUSPENDED") return "SUSPENDED";
  return "PENDING";
}

function shopStatusFor(userStatus: string): ShopStatus {
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
    const { page, limit } = paginationSchema.parse(req.query);
    const { offset } = paginate(page, limit);
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

    const userColumns = {
      id: users.id,
      email: users.email,
      name: users.name,
      phone: users.phone,
      role: users.role,
      status: users.status,
      createdAt: users.createdAt,
    };

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [{ count: total }] = whereClause
      ? await db.select({ count: sql<number>`count(*)::int` }).from(users).where(whereClause)
      : await db.select({ count: sql<number>`count(*)::int` }).from(users);

    const rows = whereClause
      ? await db.select(userColumns).from(users).where(whereClause).limit(limit).offset(offset)
      : await db.select(userColumns).from(users).limit(limit).offset(offset);

    // For rider listings, enrich with vehicle details so the Admin
    // panel can show them (left join semantics via second query).
    if (roleParam === "RIDER" && rows.length > 0) {
      const riderRows = await db
        .select({
          userId: riders.userId,
          vehicleType: riders.vehicleType,
          vehicleNumber: riders.vehicleNumber,
          licenseNumber: riders.licenseNumber,
        })
        .from(riders)
        .where(inArray(riders.userId, rows.map((r) => r.id)));
      const byUser = new Map(riderRows.map((r) => [r.userId, r]));
      const enriched = rows.map((r) => ({
        ...r,
        vehicleType: byUser.get(r.id)?.vehicleType ?? null,
        vehicleNumber: byUser.get(r.id)?.vehicleNumber || null,
        licenseNumber: byUser.get(r.id)?.licenseNumber || null,
      }));
      res.json(paginatedResponse(enriched, total, page, limit));
      return;
    }

    res.json(paginatedResponse(rows, total, page, limit));
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
    const targetId = parseUUID(req.params.id as string, "user ID");
    assertNotSelf(req.user.id, targetId);

    const user = await loadUser(targetId);
    assertTransition(user.status, "ACTIVE");

    // A shop owner must have created their shop before approval —
    // otherwise the approval has nothing to approve and a shop
    // created later would be stuck PENDING with no approval path.
    if (user.role === "SHOP_OWNER") {
      const [shop] = await db
        .select({ id: shops.id })
        .from(shops)
        .where(eq(shops.ownerId, targetId))
        .limit(1);
      if (!shop) {
        throw new BadRequestError(
          "This shop owner has not set up their shop yet — approve after the shop is created",
          "ERR_NO_SHOP_TO_APPROVE",
        );
      }
    }

    const [updated] = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(users)
        .set({ status: "ACTIVE" })
        .where(eq(users.id, targetId))
        .returning({
          id: users.id,
          email: users.email,
          name: users.name,
          role: users.role,
          status: users.status,
        });

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

    notifyUserAsync(
      targetId,
      updated.role === "SHOP_OWNER" ? "Your shop is live! 🎉" : "You're approved! 🎉",
      updated.role === "SHOP_OWNER"
        ? "Rinzo approved your shop — customers can now find you and place orders."
        : "Rinzo approved your account — you can start delivering now.",
      { type: "ACCOUNT_APPROVED" },
    );

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
    const targetId = parseUUID(req.params.id as string, "user ID");
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
        .returning({
          id: users.id,
          email: users.email,
          name: users.name,
          role: users.role,
          status: users.status,
        });

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
//
// Suspending a SHOP_OWNER also auto-cancels their shop's
// PLACED orders (nothing physical has happened yet — no
// pickup, no cash). Orders already in motion are left for
// the admin to resolve with the existing override tools.
// ─────────────────────────────────────────────────────────
export async function suspendUser(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const targetId = parseUUID(req.params.id as string, "user ID");
    assertNotSelf(req.user.id, targetId);

    const user = await loadUser(targetId);
    assertTransition(user.status, "SUSPENDED");

    const result = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(users)
        .set({ status: "SUSPENDED" })
        .where(eq(users.id, targetId))
        .returning({
          id: users.id,
          email: users.email,
          name: users.name,
          role: users.role,
          status: users.status,
        });

      await syncRelatedStatus(tx, row.role, row.id, "SUSPENDED");

      // ── Auto-cancel PLACED orders for a suspended shop owner ──
      let cancelledPlacedOrders = 0;
      if (row.role === "SHOP_OWNER") {
        const ownedShops = await tx
          .select({ id: shops.id })
          .from(shops)
          .where(eq(shops.ownerId, targetId));
        const shopIds = ownedShops.map((s) => s.id);

        if (shopIds.length > 0) {
          const cancelled = await tx
            .update(orders)
            .set({ status: "CANCELLED", updatedAt: new Date() })
            .where(
              and(
                inArray(orders.shopId, shopIds),
                eq(orders.status, "PLACED"),
              ),
            )
            .returning({ id: orders.id, customerId: orders.customerId });

          cancelledPlacedOrders = cancelled.length;

          if (cancelled.length > 0) {
            await tx.insert(orderEvents).values(
              cancelled.map((o) => ({
                orderId: o.id,
                fromStatus: "PLACED" as OrderStatus,
                toStatus: "CANCELLED" as OrderStatus,
                actor: "ADMIN",
                actorId: req.user.id,
              })),
            );
          }

          // Tell affected customers their order won't be fulfilled
          for (const o of cancelled) {
            notifyUserAsync(
              o.customerId,
              "Order cancelled",
              "The shop is temporarily unavailable, so your order was cancelled. Please order from another shop.",
              { type: "ORDER_CANCELLED", orderId: o.id },
            );
          }
        }
      }

      await tx.insert(adminEvents).values({
        adminId: req.user.id,
        action: "SUSPEND_USER",
        targetType: "USER",
        targetId,
        details: { previousStatus: user.status, role: row.role, cancelledPlacedOrders },
      });

      return { ...row, cancelledPlacedOrders };
    });

    notifyUserAsync(
      targetId,
      "Account suspended",
      "Your Rinzo account has been suspended. Contact support for details.",
      { type: "ACCOUNT_SUSPENDED" },
    );

    res.json(result);
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────
// GET /api/admin/users/:id/impact
//
// What would suspending this user affect right now?
// Returns active (non-terminal) order counts so the Admin
// UI can warn before suspension.
// ─────────────────────────────────────────────────────────

const ACTIVE_ORDER_STATUSES: OrderStatus[] = [
  "PLACED",
  "SHOP_ACCEPTED",
  "PICKUP_OFFERED",
  "PICKUP_ASSIGNED",
  "PICKED_UP_FROM_CUSTOMER",
  "AT_SHOP",
  "READY",
  "OUT_FOR_DELIVERY",
];

export async function getUserImpact(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const targetId = parseUUID(req.params.id as string, "user ID");
    const user = await loadUser(targetId);

    let rows: { status: string }[] = [];

    if (user.role === "SHOP_OWNER") {
      const ownedShops = await db
        .select({ id: shops.id })
        .from(shops)
        .where(eq(shops.ownerId, targetId));
      const shopIds = ownedShops.map((s) => s.id);
      if (shopIds.length > 0) {
        rows = await db
          .select({ status: orders.status })
          .from(orders)
          .where(
            and(
              inArray(orders.shopId, shopIds),
              inArray(orders.status, ACTIVE_ORDER_STATUSES),
            ),
          );
      }
    } else if (user.role === "RIDER") {
      const [rider] = await db
        .select({ id: riders.id })
        .from(riders)
        .where(eq(riders.userId, targetId))
        .limit(1);
      if (rider) {
        rows = await db
          .select({ status: orders.status })
          .from(orders)
          .where(
            and(
              eq(orders.riderId, rider.id),
              inArray(orders.status, ACTIVE_ORDER_STATUSES),
            ),
          );
      }
    } else {
      rows = await db
        .select({ status: orders.status })
        .from(orders)
        .where(
          and(
            eq(orders.customerId, targetId),
            inArray(orders.status, ACTIVE_ORDER_STATUSES),
          ),
        );
    }

    const byStatus: Record<string, number> = {};
    for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;

    res.json({
      role: user.role,
      totalActiveOrders: rows.length,
      byStatus,
      // PLACED orders are auto-cancelled when a shop owner is suspended
      placedWillBeCancelled: user.role === "SHOP_OWNER" ? (byStatus["PLACED"] ?? 0) : 0,
    });
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
      .set({ status: riderStatusFor(userStatus) })
      .where(eq(riders.userId, userId));
  } else if (role === "SHOP_OWNER") {
    await tx
      .update(shops)
      .set({ status: shopStatusFor(userStatus) })
      .where(eq(shops.ownerId, userId));
  }
}
