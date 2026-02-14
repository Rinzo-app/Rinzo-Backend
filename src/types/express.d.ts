import type { AuthUser } from "../lib/types.js";

// ─────────────────────────────────────────────────────────
// Express module augmentation
//
// Declares `user` on every Express Request so that:
//   1. Middleware can set req.user without casting.
//   2. Handlers operating under requireAuth can read req.user.
//
// The property is optional because unauthenticated routes
// will NOT have it populated.
// ─────────────────────────────────────────────────────────

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthUser;
  }
}
