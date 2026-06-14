import type { Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { users } from "../../db/schema/users.js";
import { riders } from "../../db/schema/riders.js";
import { firebaseAuth } from "../../lib/firebase-admin.js";
import {
  UnauthorizedError,
  ConflictError,
  BadRequestError,
} from "../../lib/errors.js";
import {
  registerCustomerSchema,
  registerShopSchema,
  registerRiderSchema,
  updateProfileSchema,
} from "./auth.schema.js";
import type { Request } from "express";
import type { AuthenticatedRequest } from "../../lib/types.js";

// ─────────────────────────────────────────────────────────
// Helper: extract & verify Firebase ID token from
// Authorization header.  Returns the decoded token.
// ─────────────────────────────────────────────────────────
async function verifyFirebaseToken(req: Request) {
  if (!firebaseAuth) {
    throw new UnauthorizedError("Firebase authentication service unavailable");
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    throw new UnauthorizedError("Missing or malformed Authorization header");
  }

  const idToken = authHeader.slice(7);
  const decoded = await firebaseAuth.verifyIdToken(idToken).catch(() => null);
  if (!decoded) {
    throw new UnauthorizedError("Invalid or expired Firebase ID token");
  }

  return decoded;
}

// ─────────────────────────────────────────────────────────
// Helper: reject if firebaseUid is already linked to a user
// ─────────────────────────────────────────────────────────
async function assertNewFirebaseUid(uid: string) {
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.firebaseUid, uid))
    .limit(1);

  if (existing) {
    throw new ConflictError(
      "A user with this Firebase account already exists",
    );
  }
}

// ─────────────────────────────────────────────────────────
// POST /api/auth/register/customer
// ─────────────────────────────────────────────────────────
export async function registerCustomer(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const decoded = await verifyFirebaseToken(req);
    const body = registerCustomerSchema.safeParse(req.body);
    if (!body.success) {
      throw new BadRequestError(body.error.errors[0]?.message ?? "Invalid input");
    }

    await assertNewFirebaseUid(decoded.uid);

    const [user] = await db
      .insert(users)
      .values({
        firebaseUid: decoded.uid,
        role: "CUSTOMER",
        name: body.data.name,
        phone: body.data.phone,
        email: body.data.email ?? decoded.email ?? null,
        status: "ACTIVE",
      })
      .returning({
        id: users.id,
        role: users.role,
        name: users.name,
        status: users.status,
        createdAt: users.createdAt,
      });

    res.status(201).json(user);
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────
// POST /api/auth/register/shop
// ─────────────────────────────────────────────────────────
export async function registerShop(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const decoded = await verifyFirebaseToken(req);
    const body = registerShopSchema.safeParse(req.body);
    if (!body.success) {
      throw new BadRequestError(body.error.errors[0]?.message ?? "Invalid input");
    }

    await assertNewFirebaseUid(decoded.uid);

    const [user] = await db
      .insert(users)
      .values({
        firebaseUid: decoded.uid,
        role: "SHOP_OWNER",
        name: body.data.name,
        phone: body.data.phone,
        email: body.data.email ?? decoded.email ?? null,
        // Domain contract §2: shop owners start PENDING and are
        // activated by admin approval (which also approves their shop).
        status: "PENDING",
      })
      .returning({
        id: users.id,
        role: users.role,
        name: users.name,
        status: users.status,
        createdAt: users.createdAt,
      });

    res.status(201).json(user);
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────
// POST /api/auth/register/rider
// ─────────────────────────────────────────────────────────
export async function registerRider(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const decoded = await verifyFirebaseToken(req);
    const body = registerRiderSchema.safeParse(req.body);
    if (!body.success) {
      throw new BadRequestError(body.error.errors[0]?.message ?? "Invalid input");
    }

    await assertNewFirebaseUid(decoded.uid);

    // Create user + rider row in a transaction
    const result = await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          firebaseUid: decoded.uid,
          role: "RIDER",
          name: body.data.name,
          phone: body.data.phone,
          email: body.data.email ?? decoded.email ?? null,
          // Domain contract §2: riders start PENDING and are
          // activated by admin approval.
          status: "PENDING",
        })
        .returning({
          id: users.id,
          role: users.role,
          name: users.name,
          status: users.status,
          createdAt: users.createdAt,
        });

      const [rider] = await tx
        .insert(riders)
        .values({
          userId: user.id,
          phone: body.data.phone,
          vehicleType: body.data.vehicleType,
          vehicleNumber: body.data.vehicleNumber ?? "",
        })
        .returning({ riderId: riders.id, vehicleType: riders.vehicleType });

      return { ...user, riderId: rider.riderId, vehicleType: rider.vehicleType };
    });

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────
// GET /api/auth/me
// Returns the authenticated user's basic profile.
// Requires requireAuth middleware (no role guard).
// ─────────────────────────────────────────────────────────
export async function getMe(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const [user] = await db
    .select({
      id: users.id,
      name: users.name,
      phone: users.phone,
      email: users.email,
      role: users.role,
      status: users.status,
    })
    .from(users)
    .where(eq(users.id, req.user.id))
    .limit(1);

  if (!user) {
    res.status(404).json({ message: "User not found" });
    return;
  }

  res.json(user);
}

// ─────────────────────────────────────────────────────────
// PATCH /api/auth/me
// Self-service update of the authenticated user's name / phone.
// ─────────────────────────────────────────────────────────
export async function updateMe(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = updateProfileSchema.safeParse(req.body);
    if (!body.success) {
      throw new BadRequestError(body.error.errors[0]?.message ?? "Invalid input");
    }

    const setFields: Record<string, unknown> = {};
    if (body.data.name !== undefined) setFields.name = body.data.name;
    if (body.data.phone !== undefined) setFields.phone = body.data.phone;

    const [updated] = await db
      .update(users)
      .set(setFields)
      .where(eq(users.id, req.user.id))
      .returning({
        id: users.id,
        name: users.name,
        phone: users.phone,
        email: users.email,
        role: users.role,
        status: users.status,
      });

    if (!updated) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    res.json(updated);
  } catch (err) {
    next(err);
  }
}
