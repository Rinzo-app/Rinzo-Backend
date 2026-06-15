import { pgTable, uuid, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { orders } from "./orders.js";
import { shops } from "./shops.js";
import { users } from "./users.js";
import { riders } from "./riders.js";

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
  rating: integer("rating").notNull(), // 1–5 (shop)
  comment: text("comment"),
  // Optional rider rating for the same order (1–5).
  riderId: uuid("rider_id").references(() => riders.id),
  riderRating: integer("rider_rating"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  shopIdx: index("reviews_shop_id_idx").on(t.shopId),
  riderIdx: index("reviews_rider_id_idx").on(t.riderId),
}));
