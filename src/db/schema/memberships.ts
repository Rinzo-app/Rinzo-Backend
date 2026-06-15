import { pgTable, uuid, varchar, timestamp, index } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { plans } from "./plans.js";

// ── Customer memberships ───────────────────────────────
// A purchased/granted membership pass. Active while now < expiresAt and
// status = ACTIVE. source records how it was activated.
export const memberships = pgTable("memberships", {
  id: uuid("id").defaultRandom().primaryKey(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => users.id),
  planId: uuid("plan_id")
    .notNull()
    .references(() => plans.id),
  status: varchar("status", { length: 20 }).notNull().default("ACTIVE"), // ACTIVE | EXPIRED | CANCELLED
  source: varchar("source", { length: 20 }).notNull().default("ADMIN"), // ADMIN | UPI
  startsAt: timestamp("starts_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  customerIdx: index("memberships_customer_id_idx").on(t.customerId),
}));
