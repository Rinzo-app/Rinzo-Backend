import type { Response, NextFunction } from "express";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { db } from "../../db/client.js";
import { plans } from "../../db/schema/plans.js";
import { memberships } from "../../db/schema/memberships.js";
import { users } from "../../db/schema/users.js";
import { adminEvents } from "../../db/schema/admin-events.js";
import type { AuthenticatedRequest } from "../../lib/types.js";
import { BadRequestError, NotFoundError } from "../../lib/errors.js";

// ── Plans ──────────────────────────────────────────────

export async function listPlans(
  _req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const rows = await db.select().from(plans).orderBy(desc(plans.createdAt));
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

const planSchema = z.object({
  name: z.string().trim().min(1).max(100),
  price: z.number().int().min(0).max(10_000_000),
  durationDays: z.number().int().min(1).max(365),
  freeDelivery: z.boolean().optional().default(false),
  discountBps: z.number().int().min(0).max(10_000).optional().default(0),
});

export async function createPlan(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = planSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.issues.map((i) => i.message).join("; "));
    }
    const [created] = await db.insert(plans).values(parsed.data).returning();
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
}

const planUpdateSchema = planSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export async function updatePlan(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = planUpdateSchema.safeParse(req.body);
    if (!parsed.success || Object.keys(parsed.data).length === 0) {
      throw new BadRequestError("No valid fields to update");
    }
    const [updated] = await db
      .update(plans)
      .set(parsed.data)
      .where(eq(plans.id, req.params.id as string))
      .returning();
    if (!updated) throw new NotFoundError("Plan not found", "ERR_PLAN_NOT_FOUND");
    res.json(updated);
  } catch (err) {
    next(err);
  }
}

// ── Memberships ────────────────────────────────────────

export async function listMemberships(
  _req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const rows = await db
      .select({
        id: memberships.id,
        status: memberships.status,
        source: memberships.source,
        startsAt: memberships.startsAt,
        expiresAt: memberships.expiresAt,
        customerName: users.name,
        customerEmail: users.email,
        planName: plans.name,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.customerId))
      .innerJoin(plans, eq(plans.id, memberships.planId))
      .orderBy(desc(memberships.createdAt))
      .limit(100);
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

const grantSchema = z.object({
  email: z.string().email(),
  planId: z.string().uuid(),
});

// POST /api/admin/memberships/grant — activate a membership for a
// customer (e.g. after collecting cash offline).
export async function grantMembership(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = grantSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.issues.map((i) => i.message).join("; "));
    }

    const [customer] = await db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.email, parsed.data.email))
      .limit(1);
    if (!customer || customer.role !== "CUSTOMER") {
      throw new NotFoundError("No customer with that email", "ERR_CUSTOMER_NOT_FOUND");
    }

    const [plan] = await db
      .select()
      .from(plans)
      .where(eq(plans.id, parsed.data.planId))
      .limit(1);
    if (!plan) throw new NotFoundError("Plan not found", "ERR_PLAN_NOT_FOUND");

    const expiresAt = new Date(Date.now() + plan.durationDays * 24 * 60 * 60 * 1000);
    const [m] = await db
      .insert(memberships)
      .values({
        customerId: customer.id,
        planId: plan.id,
        status: "ACTIVE",
        source: "ADMIN",
        expiresAt,
      })
      .returning();

    await db.insert(adminEvents).values({
      adminId: req.user.id,
      action: "GRANT_MEMBERSHIP",
      targetType: "USER",
      targetId: customer.id,
      details: { planId: plan.id, planName: plan.name, expiresAt },
    });

    res.status(201).json(m);
  } catch (err) {
    next(err);
  }
}
