import type { Response, NextFunction } from "express";
import { and, eq, notInArray, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { users } from "../../db/schema/users.js";
import { riders } from "../../db/schema/riders.js";
import { shops } from "../../db/schema/shops.js";
import { orders } from "../../db/schema/orders.js";
import { payments } from "../../db/schema/payments.js";
import { addresses } from "../../db/schema/addresses.js";
import { favorites } from "../../db/schema/favorites.js";
import { pushTokens } from "../../db/schema/push-tokens.js";
import { firebaseAuth } from "../../lib/firebase-admin.js";
import { BadRequestError, ConflictError } from "../../lib/errors.js";
import type { AuthenticatedRequest } from "../../lib/types.js";
import type { OrderStatus } from "../../lib/order-machine.js";

// Orders in these statuses are "done" — anything else is in-flight and
// blocks account deletion (money/logistics still pending).
const TERMINAL: OrderStatus[] = ["DELIVERED", "CANCELLED", "REJECTED_BY_SHOP"];

async function hasActiveOrders(userId: string, role: string): Promise<boolean> {
  let whereClause;
  if (role === "CUSTOMER") {
    whereClause = and(eq(orders.customerId, userId), notInArray(orders.status, TERMINAL));
  } else if (role === "SHOP_OWNER") {
    const [shop] = await db
      .select({ id: shops.id })
      .from(shops)
      .where(eq(shops.ownerId, userId))
      .limit(1);
    if (!shop) return false;
    whereClause = and(eq(orders.shopId, shop.id), notInArray(orders.status, TERMINAL));
  } else if (role === "RIDER") {
    const [rider] = await db
      .select({ id: riders.id })
      .from(riders)
      .where(eq(riders.userId, userId))
      .limit(1);
    if (!rider) return false;
    whereClause = and(eq(orders.riderId, rider.id), notInArray(orders.status, TERMINAL));
  } else {
    return false;
  }
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(orders)
    .where(whereClause);
  return count > 0;
}

// ─────────────────────────────────────────────────────────
// DELETE /api/auth/me — the user deletes their own account.
//
// Blocks while in-flight orders exist. Otherwise anonymizes the
// users row (PII cleared, Firebase auth record removed) but keeps it
// so order history stays intact. Personal side-data is removed.
// ─────────────────────────────────────────────────────────
export async function deleteAccount(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id: userId, role } = req.user;

    if (role === "ADMIN") {
      throw new BadRequestError(
        "Admin accounts can't be self-deleted",
        "ERR_ADMIN_DELETE",
      );
    }

    if (await hasActiveOrders(userId, role)) {
      throw new ConflictError(
        "You have orders in progress. Please wait for them to complete or cancel them before deleting your account.",
        "ERR_ACTIVE_ORDERS",
      );
    }

    // A rider holding collected COD cash owes money to the platform/shops —
    // block deletion until it's settled (DELIVERED orders are terminal, so
    // the active-orders check above wouldn't catch this).
    if (role === "RIDER") {
      const [rider] = await db
        .select({ id: riders.id })
        .from(riders)
        .where(eq(riders.userId, userId))
        .limit(1);
      if (rider) {
        const [{ cash }] = await db
          .select({ cash: sql<number>`coalesce(sum(${payments.amount}), 0)::int` })
          .from(payments)
          .innerJoin(orders, eq(orders.id, payments.orderId))
          .where(
            and(
              eq(payments.status, "COLLECTED"),
              eq(payments.method, "COD"),
              eq(orders.riderId, rider.id),
            ),
          );
        if (cash > 0) {
          throw new ConflictError(
            `You're still holding ₹${(cash / 100).toFixed(0)} in collected cash. Please hand it over and have it settled before deleting your account.`,
            "ERR_UNSETTLED_CASH",
          );
        }
      }
    }

    // Grab the Firebase UID before we null it out.
    const [row] = await db
      .select({ firebaseUid: users.firebaseUid })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    await db.transaction(async (tx) => {
      // Remove personal side-data.
      await tx.delete(addresses).where(eq(addresses.customerId, userId));
      await tx.delete(favorites).where(eq(favorites.customerId, userId));
      await tx.delete(pushTokens).where(eq(pushTokens.userId, userId));

      // Role-specific cleanup (rows kept for order-history FK integrity).
      if (role === "RIDER") {
        await tx
          .update(riders)
          .set({
            isAvailable: false,
            status: "SUSPENDED",
            dlImageUrl: null,
            rcImageUrl: null,
            selfieUrl: null,
          })
          .where(eq(riders.userId, userId));
      } else if (role === "SHOP_OWNER") {
        await tx
          .update(shops)
          .set({ isOpen: false, status: "SUSPENDED" })
          .where(eq(shops.ownerId, userId));
      }

      // Anonymize the user; clearing firebaseUid also severs login.
      await tx
        .update(users)
        .set({
          name: "Deleted user",
          email: null,
          phone: null,
          firebaseUid: null,
          status: "SUSPENDED",
          deletedAt: new Date(),
        })
        .where(eq(users.id, userId));
    });

    // Best-effort: remove the Firebase auth account so the login is gone.
    if (row?.firebaseUid && firebaseAuth) {
      await firebaseAuth.deleteUser(row.firebaseUid).catch(() => {});
    }

    res.json({ ok: true, deleted: true });
  } catch (err) {
    next(err);
  }
}
