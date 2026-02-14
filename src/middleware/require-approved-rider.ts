import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { riders } from "../db/schema/riders.js";
import { ForbiddenError } from "../lib/errors.js";
import type { AuthenticatedRequest } from "../lib/types.js";

// ─────────────────────────────────────────────────────────
// APPROVED RIDER GUARD
//
// Blocks RIDER users whose riders.status is not "APPROVED".
// Must be placed AFTER requireAuth + requireRole("RIDER").
//
// Exception: GET /api/rider/profile is excluded so the
// status-blocked screen can still poll profile data.
// ─────────────────────────────────────────────────────────

export function requireApprovedRider() {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const user = (req as AuthenticatedRequest).user;

    // Only apply to RIDER role
    if (!user || user.role !== "RIDER") {
      return next();
    }

    try {
      const [rider] = await db
        .select({ status: riders.status })
        .from(riders)
        .where(eq(riders.userId, user.id))
        .limit(1);

      if (!rider || (rider.status !== "APPROVED" && rider.status !== "ACTIVE")) {
        return next(
          new ForbiddenError(
            "Rider account is pending approval",
            "ERR_RIDER_NOT_APPROVED",
          ),
        );
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}
