import type { Request, Response, NextFunction } from "express";
import { ForbiddenError, UnauthorizedError } from "../lib/errors.js";
import type { UserRole } from "../lib/types.js";

// ─────────────────────────────────────────────────────────
// ROLE GUARD
//
// Returns middleware that rejects requests whose
// authenticated user does not carry one of the allowed roles.
//
// Usage:
//   router.patch("/shops/:id/status", requireAuth, requireRole("ADMIN"), handler);
//   router.post("/orders",            requireAuth, requireRole("CUSTOMER"), handler);
//   router.get("/orders",             requireAuth, requireRole("CUSTOMER", "SHOP_OWNER", "ADMIN"), handler);
// ─────────────────────────────────────────────────────────

export function requireRole(...allowed: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const user = req.user;

    if (!user) {
      return next(new UnauthorizedError("Authentication required"));
    }

    // Suspended users are blocked regardless of role
    if (user.status === "SUSPENDED") {
      return next(new ForbiddenError("Account is suspended", "ERR_SUSPENDED"));
    }

    if (!allowed.includes(user.role)) {
      return next(
        new ForbiddenError(
          `Role '${user.role}' is not permitted for this action`,
          "ERR_ROLE_DENIED",
        ),
      );
    }

    next();
  };
}
