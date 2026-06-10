import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index.js";

// ── Database connection ──────────────────────────────────
//
// DATABASE_URL is the single source of truth for the
// connection string.  assertProductionEnv() in server.ts
// guarantees it is present before this module is reached
// in production.
//
// SSL behaviour:
//   local Postgres (localhost/127.0.0.1) → TLS disabled.
//   anything else (Neon, Supabase, Railway, …) → TLS enabled
//   with certificate verification ON, in every environment.
//   Neon rejects non-TLS connections, so dev must use TLS too.

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

const isProduction = process.env.NODE_ENV === "production";
const isLocalDb = /@(localhost|127\.0\.0\.1)[:/]/.test(connectionString);

const pool = new pg.Pool({
  connectionString,
  ssl: isLocalDb
    ? false
    : {
        rejectUnauthorized: true,
        // Set DB_CA_CERT to a PEM-encoded CA bundle if your
        // database provider uses a private CA:
        ...(process.env.DB_CA_CERT ? { ca: process.env.DB_CA_CERT } : {}),
      },

  // ── Connection pool tuning ─────────────────────────────
  max: isProduction ? 20 : 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

export const db = drizzle(pool, { schema });
export { pool };