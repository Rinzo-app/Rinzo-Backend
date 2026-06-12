import { pgTable, uuid, integer, varchar, timestamp } from "drizzle-orm/pg-core";
import { paymentMethodEnum, paymentStatusEnum } from "./enums.js";
import { orders } from "./orders.js";

// ── One payment per order ──────────────────────────────
export const payments = pgTable("payments", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id")
    .notNull()
    .unique()                               // enforces 1:1
    .references(() => orders.id),
  amount: integer("amount").notNull(),      // same unit as orders.totalAmount
  method: paymentMethodEnum("method").notNull().default("COD"),
  status: paymentStatusEnum("status").notNull().default("PENDING"),
  collectedBy: varchar("collected_by", { length: 50 }), // e.g. "SYSTEM" / "RIDER:<id>" / "UPI:phonepe"
  collectedAt: timestamp("collected_at"),
  settledAt: timestamp("settled_at"),
  // Online payment provider linkage (null for pure COD)
  provider: varchar("provider", { length: 30 }),
  providerOrderId: varchar("provider_order_id", { length: 80 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
