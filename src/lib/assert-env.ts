/**
 * Fail fast if critical env vars are missing in production.
 * Call this at the very top of server.ts before any listen().
 */
export function assertProductionEnv(): void {
  const nodeEnv = process.env.NODE_ENV ?? "development";

  if (nodeEnv !== "production") return;

  const missing: string[] = [];

  if (!process.env.DATABASE_URL) missing.push("DATABASE_URL");
  if (!process.env.ADMIN_JWT_SECRET) missing.push("ADMIN_JWT_SECRET");
  if (!process.env.FIREBASE_PROJECT_ID) missing.push("FIREBASE_PROJECT_ID");
  if (!process.env.FIREBASE_CLIENT_EMAIL) missing.push("FIREBASE_CLIENT_EMAIL");
  if (!process.env.FIREBASE_PRIVATE_KEY) missing.push("FIREBASE_PRIVATE_KEY");

  if (missing.length > 0) {
    console.error(
      JSON.stringify({
        level: "fatal",
        type: "STARTUP",
        message:
          `Required secrets missing in production: ${missing.join(", ")}. ` +
          "Server will NOT start.",
        ts: new Date().toISOString(),
      }),
    );
    process.exit(1);
  }
}
