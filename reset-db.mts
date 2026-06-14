/**
 * DESTRUCTIVE — wipes all transactional data for a fresh start.
 *
 * Keeps: the ADMIN user(s), the database schema, and platform_settings
 * (pricing/timeouts). Deletes everything else + the Firebase Auth
 * accounts that aren't the admin.
 *
 * Usage (guarded — must pass --confirm):
 *   E2E_ADMIN_EMAIL=admin@rinzo.app npx tsx reset-db.mts --confirm [baseUrl-ignored]
 */
import "dotenv/config";
import { ne } from "drizzle-orm";

if (!process.argv.includes("--confirm")) {
  console.error("Refusing to run without --confirm. This permanently deletes data.");
  process.exit(1);
}

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@rinzo.app";

const { firebaseAuth } = await import("./src/lib/firebase-admin.js");
const { db, pool } = await import("./src/db/client.js");
const schema = await import("./src/db/schema/index.js");

async function count(table: any): Promise<number> {
  const rows = await db.select().from(table);
  return rows.length;
}

console.log(`\n🧨 Rinzo DB RESET — keeping admin (${ADMIN_EMAIL}) + platform_settings\n`);

// ── 1. Delete data tables in FK-safe order (children → parents) ──
const steps: [string, () => Promise<unknown>][] = [
  ["rider_settlements", () => db.delete(schema.riderSettlements)],
  ["ledger_entries", () => db.delete(schema.ledgerEntries)],
  ["order_events", () => db.delete(schema.orderEvents)],
  ["order_items", () => db.delete(schema.orderItems)],
  ["refunds", () => db.delete(schema.refunds)],
  ["payments", () => db.delete(schema.payments)],
  ["reviews", () => db.delete(schema.reviews)],
  ["disputes", () => db.delete(schema.disputes)],
  ["favorites", () => db.delete(schema.favorites)],
  ["addresses", () => db.delete(schema.addresses)],
  ["push_tokens", () => db.delete(schema.pushTokens)],
  ["orders", () => db.delete(schema.orders)],
  ["services", () => db.delete(schema.services)],
  ["riders", () => db.delete(schema.riders)],
  ["shops", () => db.delete(schema.shops)],
  ["admin_events", () => db.delete(schema.adminEvents)],
  ["users (non-admin)", () => db.delete(schema.users).where(ne(schema.users.role, "ADMIN"))],
];

for (const [name, run] of steps) {
  await run();
  console.log(`  ✔ cleared ${name}`);
}

const remainingUsers = await count(schema.users);
const settings = await count(schema.platformSettings);
console.log(`\n  users remaining (admins): ${remainingUsers}`);
console.log(`  platform_settings rows kept: ${settings}`);

// ── 2. Delete Firebase Auth users except the admin ──
console.log(`\nDeleting Firebase Auth accounts (except ${ADMIN_EMAIL})…`);
if (firebaseAuth) {
  let deleted = 0;
  let nextPageToken: string | undefined = undefined;
  do {
    const list: any = await firebaseAuth.listUsers(1000, nextPageToken);
    const uids = list.users
      .filter((u: any) => (u.email ?? "").toLowerCase() !== ADMIN_EMAIL.toLowerCase())
      .map((u: any) => u.uid);
    if (uids.length > 0) {
      const res = await firebaseAuth.deleteUsers(uids);
      deleted += res.successCount;
    }
    nextPageToken = list.pageToken;
  } while (nextPageToken);
  console.log(`  ✔ deleted ${deleted} Firebase account(s)`);
} else {
  console.log("  ⚠ Firebase Admin not initialised — skipped");
}

await pool.end();
console.log("\n✅ Reset complete — fresh start (admin + pricing kept).\n");
process.exit(0);
