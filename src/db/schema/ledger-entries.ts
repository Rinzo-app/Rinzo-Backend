import { pgTable, uuid, integer, jsonb, timestamp } from "drizzle-orm/pg-core";
import { ledgerEntityTypeEnum, ledgerReasonEnum } from "./enums.js";
import { orders } from "./orders.js";

// ── Append-only ledger for platform economics ──────────
export const ledgerEntries = pgTable("ledger_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  entityType: ledgerEntityTypeEnum("entity_type").notNull(), // PLATFORM | SHOP | RIDER
  entityId: uuid("entity_id"),                                // null for PLATFORM
  orderId: uuid("order_id")
    .references(() => orders.id),  // nullable — PAYOUT entries have no order
  amount: integer("amount").notNull(),                        // paise
  reason: ledgerReasonEnum("reason").notNull(),               // PLATFORM_FEE | COMMISSION | EARNING
  details: jsonb("details"),                                  // optional metadata (leg, distanceKm, rate…)
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
