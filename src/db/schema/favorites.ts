import { pgTable, uuid, timestamp, unique } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { shops } from "./shops.js";

export const favorites = pgTable(
  "favorites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => users.id),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({
    uniq: unique().on(t.customerId, t.shopId),
  }),
);
