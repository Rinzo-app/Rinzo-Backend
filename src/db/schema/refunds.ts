import { pgTable, uuid, integer, text, timestamp } from "drizzle-orm/pg-core";
import { refundStatusEnum, refundReasonEnum } from "./enums.js";
import { orders } from "./orders.js";
import { payments } from "./payments.js";

// ── One refund per payment (at most) ───────────────────
export const refunds = pgTable("refunds", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id),
  paymentId: uuid("payment_id")
    .notNull()
    .unique()                                 // enforces 1:1
    .references(() => payments.id),
  amount: integer("amount").notNull(),        // paise — excludes platformFee
  reason: refundReasonEnum("reason").notNull(),
  status: refundStatusEnum("status").notNull().default("PROCESSED"),
  note: text("note"),                          // optional admin note
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
