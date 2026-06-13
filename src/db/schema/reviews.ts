import { pgTable, uuid, integer, text, timestamp } from "drizzle-orm/pg-core";
import { orders } from "./orders.js";
import { shops } from "./shops.js";
import { users } from "./users.js";

// ── One review per delivered order ─────────────────────
// The customer rates the shop (1–5) with an optional comment.
// orderId is unique so an order can be reviewed only once.
export const reviews = pgTable("reviews", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id")
    .notNull()
    .unique()
    .references(() => orders.id),
  shopId: uuid("shop_id")
    .notNull()
    .references(() => shops.id),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => users.id),
  rating: integer("rating").notNull(), // 1–5
  comment: text("comment"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
