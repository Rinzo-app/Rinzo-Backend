import helmet from "helmet";

/**
 * Security headers via helmet.
 *
 * - hidePoweredBy: removes X-Powered-By
 * - noSniff: sets X-Content-Type-Options: nosniff
 * - frameguard: sets X-Frame-Options: DENY
 * - CSP is DISABLED — the backend serves JSON only and
 *   mobile / Expo clients do not send CSP-related headers.
 */
export const securityHeaders = helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  hidePoweredBy: true,
  noSniff: true,
  frameguard: { action: "deny" },
});
