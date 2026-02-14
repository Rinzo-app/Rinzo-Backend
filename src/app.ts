import express from "express";
import { corsMiddleware } from "./middleware/cors.js";
import { securityHeaders } from "./middleware/security-headers.js";
import { requestLogger, errorHandler } from "./middleware/index.js";
import { apiRouter } from "./routes/index.js";

const app = express();

// ── Trust reverse proxy (Nginx / ALB / Cloudflare) ───────
app.set("trust proxy", 1);

// ── Global middleware ────────────────────────────────────
app.use(securityHeaders);
app.use(corsMiddleware);
app.use(express.json());
app.use(requestLogger);

// ── Health check ─────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ── API routes ───────────────────────────────────────────
app.use("/api", apiRouter);

// ── Central error handler (must be last) ─────────────────
app.use(errorHandler);

export { app };
