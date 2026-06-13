import type { Request, Response, NextFunction } from "express";
import { ForbiddenError, UnauthorizedError } from "../lib/errors.js";

// ─────────────────────────────────────────────────────────
// Blocks an action until the user's email is verified.
// Reads the email_verified claim captured by requireAuth from the
// Firebase token (admin/dev paths are always treated as verified).
// Must run AFTER requireAuth.
// ─────────────────────────────────────────────────────────
export function requireEmailVerified(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (!req.user) {
    return next(new UnauthorizedError("Authentication required"));
  }
  if (!req.user.emailVerified) {
    return next(
      new ForbiddenError(
        "Please verify your email before continuing. Check your inbox for the verification link.",
        "ERR_EMAIL_NOT_VERIFIED",
      ),
    );
  }
  next();
}
