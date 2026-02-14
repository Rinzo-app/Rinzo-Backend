import type { Response, NextFunction } from "express";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { disputes } from "../../db/schema/disputes.js";
import { orders } from "../../db/schema/orders.js";
import { riders } from "../../db/schema/riders.js";
import { shops } from "../../db/schema/shops.js";
import { DISPUTE_CATEGORIES } from "../../lib/constants.js";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../../lib/errors.js";
import type { AuthenticatedRequest } from "../../lib/types.js";

// ── Validation schema ────────────────────────────────────
const createDisputeSchema = z.object({
  orderId: z.string().uuid("Invalid order ID"),
  category: z.enum(DISPUTE_CATEGORIES, { message: "Invalid dispute category" }),
  description: z.string().min(1).max(2000),
});

// ── Helpers ──────────────────────────────────────────────

/** Map a user role → the disputeRaisedByEnum value stored in DB. */
function roleToRaisedByType(
  role: string,
): "CUSTOMER" | "SHOP" | "RIDER" {
  switch (role) {
    case "CUSTOMER":
      return "CUSTOMER";
    case "SHOP_OWNER":
      return "SHOP";
    case "RIDER":
      return "RIDER";
    default:
      throw new ForbiddenError("Your role cannot raise disputes");
  }
}

// ── POST /api/disputes ───────────────────────────────────
export async function createDispute(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = req.user!;

    // Only CUSTOMER, SHOP_OWNER, and RIDER may raise disputes
    if (!["CUSTOMER", "SHOP_OWNER", "RIDER"].includes(user.role)) {
      throw new ForbiddenError("Your role cannot raise disputes");
    }

    // Parse & validate body
    const parsed = createDisputeSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError(
        parsed.error.issues.map((i) => i.message).join("; "),
      );
    }

    const { orderId, category, description } = parsed.data;
    const raisedByType = roleToRaisedByType(user.role);

    // ── Fetch order ──────────────────────────────────────
    const [order] = await db
      .select({
        id: orders.id,
        customerId: orders.customerId,
        shopId: orders.shopId,
        riderId: orders.riderId,
        status: orders.status,
      })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);

    if (!order) {
      throw new NotFoundError("Order not found");
    }

    // ── Ownership check ──────────────────────────────────
    if (user.role === "CUSTOMER") {
      if (order.customerId !== user.id) {
        throw new ForbiddenError("This order does not belong to you");
      }
    } else if (user.role === "SHOP_OWNER") {
      // order.shopId → shops.ownerId must equal user.id
      const [shop] = await db
        .select({ ownerId: shops.ownerId })
        .from(shops)
        .where(eq(shops.id, order.shopId))
        .limit(1);

      if (!shop || shop.ownerId !== user.id) {
        throw new ForbiddenError("This order does not belong to your shop");
      }
    } else if (user.role === "RIDER") {
      // order.riderId is a riders-table PK, not a users-table PK,
      // so we must resolve the rider record first.
      const [rider] = await db
        .select({ id: riders.id })
        .from(riders)
        .where(eq(riders.userId, user.id))
        .limit(1);

      if (!rider || order.riderId !== rider.id) {
        throw new ForbiddenError("This order is not assigned to you");
      }
    }

    // ── Duplicate check (one OPEN dispute per order per raisedByType) ──
    const [existing] = await db
      .select({ id: disputes.id })
      .from(disputes)
      .where(
        and(
          eq(disputes.orderId, orderId),
          eq(disputes.raisedByType, raisedByType),
          eq(disputes.status, "OPEN"),
        ),
      )
      .limit(1);

    if (existing) {
      throw new ConflictError(
        "You already have an open dispute for this order",
      );
    }

    // ── Insert dispute ───────────────────────────────────
    const [created] = await db
      .insert(disputes)
      .values({
        raisedByType,
        raisedById: user.id,
        orderId,
        category,
        description,
        status: "OPEN",
      })
      .returning();

    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────
// GET /api/disputes
//
// Non-admin: returns all disputes raised by the current user.
// Disputes are stored with `raisedById = users.id`, so this
// works for CUSTOMER, SHOP_OWNER, and RIDER alike.
// ─────────────────────────────────────────────────────────

export async function listMyDisputes(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const rows = await db
      .select({
        id: disputes.id,
        orderId: disputes.orderId,
        category: disputes.category,
        description: disputes.description,
        status: disputes.status,
        createdAt: disputes.createdAt,
        updatedAt: disputes.updatedAt,
        resolution: disputes.resolution,
      })
      .from(disputes)
      .where(eq(disputes.raisedById, req.user.id))
      .orderBy(desc(disputes.createdAt));

    res.status(200).json(rows);
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────
// GET /api/disputes/categories
// Returns the canonical list of dispute categories.
// ─────────────────────────────────────────────────────────
import type { Request } from "express";

export function getDisputeCategories(
  _req: Request,
  res: Response,
): void {
  res.json(DISPUTE_CATEGORIES);
}
