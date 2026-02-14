import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { db } from "../db/client.js";
import { users } from "../db/schema/users.js";
import { ForbiddenError, UnauthorizedError } from "../lib/errors.js";
import { firebaseAuth } from "../lib/firebase-admin.js";
import type { AuthUser } from "../lib/types.js";

// ─────────────────────────────────────────────────────────
// AUTH MIDDLEWARE
//
// 1. Dev bypass  — NODE_ENV === "development" only
//    + X-Dev-User-Id header → look up by users.id
// 2. Admin JWT   — HMAC-signed JWT with { sub: <userId> }
// 3. Firebase ID — verified via Firebase Admin SDK, then
//    looked up by users.firebase_uid
//
// All paths populate req.user with the same AuthUser shape.
// ─────────────────────────────────────────────────────────

const IS_DEV = process.env.NODE_ENV === "development";
const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || "";

/** Load a user row by primary key and return an AuthUser. */
async function loadUserById(id: string): Promise<AuthUser | null> {
  const [user] = await db
    .select({ id: users.id, role: users.role, status: users.status })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  return (user as AuthUser) ?? null;
}

/** Load a user row by firebase_uid and return an AuthUser. */
async function loadUserByFirebaseUid(uid: string): Promise<AuthUser | null> {
  const [user] = await db
    .select({ id: users.id, role: users.role, status: users.status })
    .from(users)
    .where(eq(users.firebaseUid, uid))
    .limit(1);
  return (user as AuthUser) ?? null;
}

export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // ── 1. Dev bypass (development only) ─────────────────
    const devUserId = req.headers["x-dev-user-id"] as string | undefined;

    if (devUserId && !IS_DEV) {
      console.warn(
        JSON.stringify({
          level: "warn",
          type: "DEV_AUTH_BLOCKED",
          message: "X-Dev-User-Id header ignored in non-development environment",
          ts: new Date().toISOString(),
        }),
      );
    }

    if (IS_DEV && devUserId) {
      const user = await loadUserById(devUserId);
      if (!user) throw new UnauthorizedError("Dev user not found");
      req.user = user;
      return checkSuspended(req, next);
    }

    // ── Extract Bearer token ─────────────────────────────
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      throw new UnauthorizedError("Missing or malformed Authorization header");
    }
    const token = authHeader.slice(7);

    // ── 2. Try Admin JWT first ───────────────────────────
    if (ADMIN_JWT_SECRET) {
      try {
        const payload = jwt.verify(token, ADMIN_JWT_SECRET) as {
          sub: string;
          [key: string]: unknown;
        };
        const userId = payload.sub;
        if (userId) {
          const user = await loadUserById(userId);
          if (user && user.role === "ADMIN") {
            req.user = user;
            return next(); // Admins are never suspended-checked
          }
        }
      } catch {
        // JWT verification failed — fall through to Firebase
      }
    }

    // ── 3. Try Firebase ID token ─────────────────────────
    if (!firebaseAuth) {
      throw new UnauthorizedError("Authentication service unavailable");
    }

    const decoded = await firebaseAuth.verifyIdToken(token).catch(() => null);
    if (!decoded) {
      throw new UnauthorizedError("Invalid or expired token");
    }

    const user = await loadUserByFirebaseUid(decoded.uid);
    if (!user) {
      throw new UnauthorizedError(
        "No platform account linked to this Firebase UID",
      );
    }

    req.user = user;
    return checkSuspended(req, next);
  } catch (err) {
    next(err);
  }
}

/**
 * Block suspended users from all routes except /api/auth/me
 * (which clients need to detect their suspension status).
 */
function checkSuspended(req: Request, next: NextFunction): void {
  if (req.user?.status === "SUSPENDED" && req.originalUrl !== "/api/auth/me") {
    return next(
      new ForbiddenError(
        "Your account has been suspended",
        "ERR_SUSPENDED",
      ),
    );
  }
  return next();
}
