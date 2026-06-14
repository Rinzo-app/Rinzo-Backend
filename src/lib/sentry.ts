import * as Sentry from "@sentry/node";

// ─────────────────────────────────────────────────────────
// Error monitoring (optional). Activates only when SENTRY_DSN
// is set, so local/dev and unconfigured deploys are no-ops.
// ─────────────────────────────────────────────────────────

let enabled = false;

export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  try {
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV ?? "development",
      tracesSampleRate: 0.1,
    });
    enabled = true;
    console.log(
      JSON.stringify({
        level: "info",
        type: "SENTRY",
        message: "Sentry error monitoring initialised",
        ts: new Date().toISOString(),
      }),
    );
  } catch {
    // Never let monitoring setup break boot.
  }
}

/** Report an unexpected error (no-op unless Sentry is configured). */
export function captureException(
  err: unknown,
  context?: Record<string, unknown>,
): void {
  if (!enabled) return;
  try {
    Sentry.captureException(err, context ? { extra: context } : undefined);
  } catch {
    // swallow
  }
}
