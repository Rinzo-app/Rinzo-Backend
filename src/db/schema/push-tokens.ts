import { pgTable, uuid, varchar, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users.js";

// ── Expo push tokens (one row per device) ────────────────
// A token is unique per device+app install; it can move between
// accounts when a different user logs in on the same device, so
// registration upserts on the token.
export const pushTokens = pgTable("push_tokens", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  token: varchar("token", { length: 200 }).notNull().unique(),
  platform: varchar("platform", { length: 20 }).notNull().default("unknown"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
