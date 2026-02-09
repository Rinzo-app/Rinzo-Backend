import type { Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { orders } from "../../db/schema/orders.js";
import { orderEvents } from "../../db/schema/order-events.js";
import { adminEvents } from "../../db/schema/admin-events.js";
import { riders } from "../../db/schema/riders.js";
import type { AuthenticatedRequest } from "../../lib/types.js";
import {
  BadRequestError,
  NotFoundError,
} from "../../lib/errors.js";
import type { OrderStatus } from "../../lib/order-machine.js";
import { assertTransition } from "../../lib/order-machine.js";
import { assignPickupSchema } from "./admin.schema.js";

// ─────────────────────────────────────────────────────────
// POST /api/admin/orders/:id/assign-pickup
// ─────────────────────────────────────────────────────────

export async function assignPickup(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const orderId = req.params.id as string;

    // ── 1. Validate body ──────────────────────────────────
    const { riderId } = assignPickupSchema.parse(req.body);

    // ── 2. Fetch order ────────────────────────────────────
    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);

    if (!order) {
      throw new NotFoundError("Order not found", "ERR_ORDER_NOT_FOUND");
    }

    // ── 3. Validate rider exists ──────────────────────────
    const [rider] = await db
      .select()
      .from(riders)
      .where(eq(riders.id, riderId))
      .limit(1);

    if (!rider) {
      throw new NotFoundError("Rider not found", "ERR_RIDER_NOT_FOUND");
    }

    // ── 4. Validate transition (actor = SYSTEM) ───────────
    assertTransition(
      order.status as OrderStatus,
      "PICKUP_ASSIGNED",
      "SYSTEM",
    );

    // ── 5. Update order in transaction ────────────────────
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(orders)
        .set({
          status: "PICKUP_ASSIGNED",
          riderId,
          updatedAt: new Date(),
        })
        .where(eq(orders.id, orderId))
        .returning();

      await tx.insert(orderEvents).values({
        orderId,
        fromStatus: order.status as OrderStatus,
        toStatus: "PICKUP_ASSIGNED",
        actor: "SYSTEM",
        actorId: req.user.id,
      });

      await tx.insert(adminEvents).values({
        adminId: req.user.id,
        action: "ASSIGN_PICKUP",
        targetType: "ORDER",
        targetId: orderId as string,
        details: { riderId, previousStatus: order.status },
      });

      return row;
    });

    // ── 6. Respond ────────────────────────────────────────
    res.status(200).json(updated);
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────
// POST /api/admin/orders/:id/assign-delivery
// ─────────────────────────────────────────────────────────

export async function assignDelivery(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const orderId = req.params.id as string;

    // ── 1. Fetch order ────────────────────────────────────
    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);

    if (!order) {
      throw new NotFoundError("Order not found", "ERR_ORDER_NOT_FOUND");
    }

    // ── 2. Ensure a rider is already assigned ─────────────
    if (!order.riderId) {
      throw new BadRequestError(
        "No rider assigned to this order — assign pickup first",
        "ERR_NO_RIDER_ASSIGNED",
      );
    }

    // ── 3. Validate transition (actor = SYSTEM) ───────────
    assertTransition(
      order.status as OrderStatus,
      "OUT_FOR_DELIVERY",
      "SYSTEM",
    );

    // ── 4. Update order in transaction ────────────────────
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(orders)
        .set({
          status: "OUT_FOR_DELIVERY",
          updatedAt: new Date(),
        })
        .where(eq(orders.id, orderId))
        .returning();

      await tx.insert(orderEvents).values({
        orderId,
        fromStatus: order.status as OrderStatus,
        toStatus: "OUT_FOR_DELIVERY",
        actor: "SYSTEM",
        actorId: req.user.id,
      });

      await tx.insert(adminEvents).values({
        adminId: req.user.id,
        action: "ASSIGN_DELIVERY",
        targetType: "ORDER",
        targetId: orderId as string,
        details: { riderId: order.riderId, previousStatus: order.status },
      });

      return row;
    });

    // ── 5. Respond ────────────────────────────────────────
    res.status(200).json(updated);
  } catch (err) {
    next(err);
  }
}
