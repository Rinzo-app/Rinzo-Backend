import type { RequestHandler, Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "./types.js";

// ─────────────────────────────────────────────────────────
// Type-safe handler wrapper
//
// Express Router methods accept RequestHandler (req: Request …),
// but our authenticated handlers narrow req to
// AuthenticatedRequest (req.user is guaranteed by middleware).
//
// `authed()` bridges the two in a SINGLE, auditable location
// rather than scattering `as any` across every route file.
//
// Usage:
//   import { authed } from "../../lib/typed-handler.js";
//   router.get("/orders", requireAuth, requireRole("ADMIN"), authed(listAllOrders));
// ─────────────────────────────────────────────────────────

type AuthRequestHandler = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => Promise<void> | void;

/**
 * Wraps an authenticated handler so it can be passed directly
 * to Express Router without an `as any` cast.
 *
 * Safety: requireAuth middleware always runs before the wrapped
 * handler, guaranteeing `req.user` is populated at runtime.
 */
export function authed(handler: AuthRequestHandler): RequestHandler {
  return handler as unknown as RequestHandler;
}
