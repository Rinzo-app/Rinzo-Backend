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
//   production  → TLS enabled, certificate verification ON.
//                 Set DB_CA_CERT to a PEM-encoded CA bundle
//                 if your provider uses a private CA.
//   development → TLS disabled (local Postgres typically
//                 does not use certificates).

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

const isProduction = process.env.NODE_ENV === "production";

const pool = new pg.Pool({
  connectionString,
  ssl: isProduction
    ? {
        rejectUnauthorized: true,
        // Uncomment the line below if your database provider
        // (e.g. Supabase, Neon, Railway) supplies a custom CA:
        // ca: process.env.DB_CA_CERT,
      }
    : false,

  // ── Connection pool tuning ─────────────────────────────
  max: isProduction ? 20 : 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

export const db = drizzle(pool, { schema });
export { pool };