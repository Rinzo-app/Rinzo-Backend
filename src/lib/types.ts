import type { Request } from "express";

// ── User role union (mirrors the DB enum) ──────────────
export type UserRole = "CUSTOMER" | "SHOP_OWNER" | "RIDER" | "ADMIN";

// ── Authenticated user payload attached to every request
//    after requireAuth middleware runs ───────────────────
export interface AuthUser {
  /** users.id (UUID) */
  id: string;
  role: UserRole;
  /** users.status */
  status: "PENDING" | "ACTIVE" | "SUSPENDED";
  /** Firebase token's email_verified claim (true for admin/dev paths). */
  emailVerified: boolean;
}

// ── Extended Request carrying the authenticated user ───
export interface AuthenticatedRequest extends Request {
  user: AuthUser;
}
