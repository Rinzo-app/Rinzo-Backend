import { pgTable, uuid, varchar, integer, boolean, timestamp } from "drizzle-orm/pg-core";

// ── Membership plans (admin-defined) ───────────────────
// A fixed-duration pass that grants benefits (free delivery and/or a
// percentage discount on items) for `durationDays` from activation.
export const plans = pgTable("plans", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  price: integer("price").notNull(), // paise
  durationDays: integer("duration_days").notNull().default(30),
  freeDelivery: boolean("free_delivery").notNull().default(false),
  discountBps: integer("discount_bps").notNull().default(0), // % off items, basis points
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
