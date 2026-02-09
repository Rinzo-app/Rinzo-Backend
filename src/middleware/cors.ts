import cors from "cors";

// ── Allowed origins for the public API ───────────────────
const DEFAULT_ORIGINS = [
  "http://localhost:3000",  // Admin panel (Vite dev)
  "http://localhost:5173",  // Admin panel (Vite alternate)
  "http://localhost:19006", // Expo web dev
];

const ALLOWED_ORIGINS: string[] = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean)
  : DEFAULT_ORIGINS;

if (process.env.NODE_ENV === "production") {
  console.log(
    JSON.stringify({
      level: "info",
      type: "CORS",
      message: `Allowed origins: ${ALLOWED_ORIGINS.join(", ")}`,
      ts: new Date().toISOString(),
    }),
  );
}

/**
 * Strict CORS — only whitelisted origins may talk to the
 * backend.  credentials is false (we use Bearer tokens, not
 * cookies).  The Authorization header is explicitly allowed.
 */
export const corsMiddleware = cors({
  origin(origin, callback) {
    // Allow requests with no origin (mobile apps, curl, server-to-server)
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origin ${origin} is not allowed`));
  },
  credentials: false,
  allowedHeaders: ["Content-Type", "Authorization"],
  methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
});
