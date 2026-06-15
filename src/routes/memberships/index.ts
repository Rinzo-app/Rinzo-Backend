import { Router } from "express";
import type { Response, NextFunction } from "express";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { plans } from "../../db/schema/plans.js";
import { memberships } from "../../db/schema/memberships.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireRole } from "../../middleware/require-role.js";
import { authed } from "../../lib/typed-handler.js";
import type { AuthenticatedRequest } from "../../lib/types.js";
import { BadRequestError, NotFoundError } from "../../lib/errors.js";
import { parseUUID } from "../../lib/validate-uuid.js";
import { getActiveMembership } from "../../lib/membership.js";
import { getPaymentProvider } from "../../lib/payments/index.js";

// GET /api/memberships/plans — active plans the customer can buy.
async function listActivePlans(
  _req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const rows = await db
      .select()
      .from(plans)
      .where(eq(plans.isActive, true))
      .orderBy(plans.price);
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

// GET /api/memberships/me — the customer's active membership (or null).
async function myMembership(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const benefit = await getActiveMembership(req.user.id);
    res.json(benefit);
  } catch (err) {
    next(err);
  }
}

// POST /api/memberships/purchase { planId } — self-serve purchase.
// Requires online payments; until PhonePe is live this is blocked in
// production (admins grant memberships in the meantime).
async function purchaseMembership(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const planId = parseUUID(req.body?.planId, "plan ID");
    const [plan] = await db
      .select()
      .from(plans)
      .where(and(eq(plans.id, planId), eq(plans.isActive, true)))
      .limit(1);
    if (!plan) throw new NotFoundError("Plan not found", "ERR_PLAN_NOT_FOUND");

    const provider = getPaymentProvider();
    const isDevSimulated =
      provider.name === "simulated" && process.env.NODE_ENV !== "production";

    if (!isDevSimulated) {
      // No live online payments yet — block self-serve purchase.
      throw new BadRequestError(
        "Online membership purchase isn't available yet. Please ask support to activate your plan.",
        "ERR_PAYMENTS_UNAVAILABLE",
      );
    }

    // Dev/simulated: activate immediately so the flow is testable.
    const expiresAt = new Date(Date.now() + plan.durationDays * 24 * 60 * 60 * 1000);
    const [m] = await db
      .insert(memberships)
      .values({
        customerId: req.user.id,
        planId: plan.id,
        status: "ACTIVE",
        source: "UPI",
        expiresAt,
      })
      .returning();
    res.status(201).json(m);
  } catch (err) {
    next(err);
  }
}

const membershipsRouter = Router();
membershipsRouter.get("/plans", requireAuth, requireRole("CUSTOMER"), authed(listActivePlans));
membershipsRouter.get("/me", requireAuth, requireRole("CUSTOMER"), authed(myMembership));
membershipsRouter.post("/purchase", requireAuth, requireRole("CUSTOMER"), authed(purchaseMembership));

export { membershipsRouter };
