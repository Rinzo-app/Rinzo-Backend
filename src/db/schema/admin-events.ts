import { pgTable, uuid, varchar, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * Audit log for admin-initiated actions.
 *
 * Every mutation performed through /api/admin/* endpoints
 * inserts a row inside the same transaction that applies
 * the change, guaranteeing consistency.
 */
export const adminEvents = pgTable("admin_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  adminId: uuid("admin_id")
    .notNull()
    .references(() => users.id),
  action: varchar("action", { length: 100 }).notNull(),
  targetType: varchar("target_type", { length: 50 }).notNull(),
  targetId: uuid("target_id").notNull(),
  details: jsonb("details"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
