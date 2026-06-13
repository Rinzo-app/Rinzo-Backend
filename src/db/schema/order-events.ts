import { pgTable, uuid, varchar, timestamp, index } from "drizzle-orm/pg-core";
import { orderStatusEnum } from "./enums.js";
import { orders } from "./orders.js";

// ── Append-only order status transition log ────────────
export const orderEvents = pgTable("order_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id),
  fromStatus: orderStatusEnum("from_status"),
  toStatus: orderStatusEnum("to_status").notNull(),
  actor: varchar("actor", { length: 20 }).notNull(),   // CUSTOMER | SHOP_OWNER | RIDER | ADMIN | SYSTEM
  actorId: uuid("actor_id").notNull(),                  // user id who triggered the transition
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  orderIdx: index("order_events_order_id_idx").on(t.orderId),
}));
