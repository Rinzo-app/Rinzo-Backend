import type { Response, NextFunction } from "express";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { orders } from "../../db/schema/orders.js";
import { shops } from "../../db/schema/shops.js";
import { riders } from "../../db/schema/riders.js";
import { reviews } from "../../db/schema/reviews.js";
import type { AuthenticatedRequest } from "../../lib/types.js";
import {
  BadRequestError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
} from "../../lib/errors.js";
import { parseUUID } from "../../lib/validate-uuid.js";

const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(500).optional(),
  // Optional rider rating (1–5) for the same order.
  riderRating: z.number().int().min(1).max(5).optional(),
});

// ─────────────────────────────────────────────────────────
// POST /api/orders/:id/review
//
// The customer rates a DELIVERED order's shop (1–5) once. The
// shop's denormalized rating/totalRatings aggregate is recomputed
// in the same transaction from all its reviews.
// ─────────────────────────────────────────────────────────
export async function submitReview(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const orderId = parseUUID(req.params.id as string, "order ID");
    const parsed = reviewSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError(
        parsed.error.issues.map((i) => i.message).join("; "),
      );
    }

    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    if (!order) {
      throw new NotFoundError("Order not found", "ERR_ORDER_NOT_FOUND");
    }
    if (order.customerId !== req.user.id) {
      throw new ForbiddenError("This is not your order", "ERR_NOT_YOUR_ORDER");
    }
    if (order.status !== "DELIVERED") {
      throw new ConflictError(
        "You can only review a delivered order",
        "ERR_ORDER_NOT_DELIVERED",
      );
    }

    const created = await db.transaction(async (tx) => {
      // Insert (orderId is unique → second attempt throws)
      // Only attach a rider rating if this order actually had a rider.
      const riderId = order.riderId ?? null;
      const riderRating = riderId ? parsed.data.riderRating ?? null : null;

      const [row] = await tx
        .insert(reviews)
        .values({
          orderId,
          shopId: order.shopId,
          customerId: req.user.id,
          rating: parsed.data.rating,
          comment: parsed.data.comment ?? null,
          riderId,
          riderRating,
        })
        .returning();

      // Recompute the shop aggregate from all its reviews
      const [agg] = await tx
        .select({
          avg: sql<number>`avg(${reviews.rating})`,
          count: sql<number>`count(*)::int`,
        })
        .from(reviews)
        .where(eq(reviews.shopId, order.shopId));

      await tx
        .update(shops)
        .set({
          rating: Math.round((agg?.avg ?? 0) * 10) / 10,
          totalRatings: agg?.count ?? 0,
        })
        .where(eq(shops.id, order.shopId));

      // Recompute the rider aggregate from their rated reviews.
      if (riderId && riderRating != null) {
        const [rAgg] = await tx
          .select({
            avg: sql<number>`avg(${reviews.riderRating})`,
            count: sql<number>`count(${reviews.riderRating})::int`,
          })
          .from(reviews)
          .where(eq(reviews.riderId, riderId));

        await tx
          .update(riders)
          .set({
            rating: Math.round((rAgg?.avg ?? 0) * 10) / 10,
            totalRatings: rAgg?.count ?? 0,
          })
          .where(eq(riders.id, riderId));
      }

      return row;
    });

    res.status(201).json(created);
  } catch (err) {
    // Unique-violation on orderId → already reviewed
    if (isUniqueViolation(err)) {
      next(new ConflictError("This order has already been reviewed", "ERR_ALREADY_REVIEWED"));
      return;
    }
    next(err);
  }
}

/** Walk the error chain for a Postgres unique-violation (23505). */
function isUniqueViolation(err: unknown): boolean {
  let e: any = err;
  while (e) {
    if (e.code === "23505") return true;
    e = e.cause;
  }
  return false;
}
