import { pgTable, uuid, integer, varchar, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { riders } from "./riders.js";

// ─────────────────────────────────────────────────────────
// A rider settling the COD cash they owe the platform.
// `amount` is the hand-over (cash collected minus the rider's
// own cut). CASH settlements are recorded by an admin; UPI
// settlements are paid by the rider through the gateway.
// ─────────────────────────────────────────────────────────
export const riderSettlements = pgTable("rider_settlements", {
  id: uuid("id").defaultRandom().primaryKey(),
  riderId: uuid("rider_id").notNull().references(() => riders.id),
  amount: integer("amount").notNull(), // hand-over owed (paise)
  cashCollected: integer("cash_collected").notNull(), // total COD cash covered (paise)
  method: varchar("method", { length: 10 }).notNull(), // CASH | UPI
  status: varchar("status", { length: 10 }).notNull().default("PENDING"), // PENDING | PAID
  coveredPaymentIds: jsonb("covered_payment_ids").notNull().default([]),
  provider: varchar("provider", { length: 30 }),
  providerOrderId: varchar("provider_order_id", { length: 80 }),
  createdBy: varchar("created_by", { length: 10 }).notNull(), // RIDER | ADMIN
  verifiedBy: uuid("verified_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  paidAt: timestamp("paid_at"),
}, (t) => ({
  riderIdx: index("rider_settlements_rider_id_idx").on(t.riderId),
  statusIdx: index("rider_settlements_status_idx").on(t.status),
}));
