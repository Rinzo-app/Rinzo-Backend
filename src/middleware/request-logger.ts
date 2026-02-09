import { randomUUID } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../lib/types.js";

// ─────────────────────────────────────────────────────────
// REQUEST LOGGER
//
// Generates a unique requestId per request, attaches it to
// res.locals for downstream use, and emits a structured
// JSON log line on response finish.
// ─────────────────────────────────────────────────────────

export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const requestId = randomUUID();
  res.locals.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);

  const start = Date.now();

  res.on("finish", () => {
    const durationMs = Date.now() - start;
    const authReq = req as Partial<AuthenticatedRequest>;
    const logEntry = {
      level: "info",
      requestId,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs,
      userId: authReq.user?.id ?? null,
      role: authReq.user?.role ?? null,
      ts: new Date().toISOString(),
    };
    console.log(JSON.stringify(logEntry));
  });

  next();
}
