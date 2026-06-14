import { pgTable, uuid, integer, varchar, timestamp, index } from "drizzle-orm/pg-core";
import { shops } from "./shops.js";

// ─────────────────────────────────────────────────────────
// A payout from the platform to a shop (its accumulated
// earnings, minus commission, already booked in the ledger).
// Recorded by an admin when they transfer the money.
// ─────────────────────────────────────────────────────────
export const shopPayouts = pgTable("shop_payouts", {
  id: uuid("id").defaultRandom().primaryKey(),
  shopId: uuid("shop_id").notNull().references(() => shops.id),
  amount: integer("amount").notNull(), // paid out (paise)
  method: varchar("method", { length: 10 }).notNull(), // BANK | UPI
  reference: varchar("reference", { length: 120 }), // bank/UPI txn ref (optional)
  createdBy: uuid("created_by").notNull(), // admin user id
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  shopIdx: index("shop_payouts_shop_id_idx").on(t.shopId),
}));
