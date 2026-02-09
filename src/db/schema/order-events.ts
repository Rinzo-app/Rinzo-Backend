import { pgTable, uuid, varchar, timestamp } from "drizzle-orm/pg-core";
import { orderStatusEnum } from "./enums";
import { orders } from "./orders";

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
});
