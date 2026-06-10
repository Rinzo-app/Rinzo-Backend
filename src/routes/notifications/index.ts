import { Router } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { pushTokens } from "../../db/schema/push-tokens.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { authed } from "../../lib/typed-handler.js";
import { BadRequestError } from "../../lib/errors.js";

const tokenSchema = z.object({
  token: z.string().min(10).max(200),
  platform: z.enum(["ios", "android", "web"]).optional(),
});

const notificationsRouter = Router();

// ── POST /api/notifications/token — register this device ──
notificationsRouter.post(
  "/token",
  requireAuth,
  authed(async (req, res, next) => {
    try {
      const parsed = tokenSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new BadRequestError(
          parsed.error.errors[0]?.message ?? "Invalid token payload",
        );
      }

      // Upsert on token: a device switching accounts re-binds its token
      await db
        .insert(pushTokens)
        .values({
          userId: req.user.id,
          token: parsed.data.token,
          platform: parsed.data.platform ?? "unknown",
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: pushTokens.token,
          set: {
            userId: req.user.id,
            platform: parsed.data.platform ?? "unknown",
            updatedAt: new Date(),
          },
        });

      res.status(200).json({ ok: true });
    } catch (err) {
      next(err);
    }
  }),
);

// ── DELETE /api/notifications/token — unregister on logout ──
notificationsRouter.delete(
  "/token",
  requireAuth,
  authed(async (req, res, next) => {
    try {
      const parsed = tokenSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new BadRequestError("Invalid token payload");
      }
      await db
        .delete(pushTokens)
        .where(eq(pushTokens.token, parsed.data.token));
      res.status(200).json({ ok: true });
    } catch (err) {
      next(err);
    }
  }),
);

export { notificationsRouter };
