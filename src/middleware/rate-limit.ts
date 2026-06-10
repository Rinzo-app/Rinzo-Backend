import rateLimit from "express-rate-limit";

/**
 * Auth limiter — applied to the /api/auth/register/* routes only.
 * (/api/auth/me is exempt: every app calls it on startup and many
 * users can share one IP behind mobile-carrier NAT.)
 * 5 requests per minute per IP.
 */
export const authLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many auth requests — try again in a minute" },
});

/**
 * Write limiter — applied to POST / PATCH routes.
 * 60 requests per minute per IP.
 */
export const writeLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many write requests — slow down" },
});
