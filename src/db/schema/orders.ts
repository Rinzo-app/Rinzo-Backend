import { pgTable, uuid, jsonb, integer, text, varchar, doublePrecision, timestamp, index } from "drizzle-orm/pg-core";
import { orderStatusEnum, rejectionReasonEnum } from "./enums.js";
import { users } from "./users.js";
import { shops } from "./shops.js";
import { riders } from "./riders.js";
import { services } from "./services.js";

export const orders = pgTable("orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => users.id),
  shopId: uuid("shop_id")
    .notNull()
    .references(() => shops.id),
  riderId: uuid("rider_id").references(() => riders.id),
  items: jsonb("items").notNull(),
  totalAmount: integer("total_amount").notNull(),
  platformFee: integer("platform_fee").notNull().default(0),
  deliveryFee: integer("delivery_fee").notNull().default(0),
  status: orderStatusEnum("status").notNull().default("PLACED"),
  pickupAddress: text("pickup_address").notNull(),
  deliveryAddress: text("delivery_address").notNull(),
  // Customer coordinates (nullable — may not have been sent)
  pickupLat: doublePrecision("pickup_lat"),
  pickupLng: doublePrecision("pickup_lng"),
  rejectionReason: rejectionReasonEnum("rejection_reason"),
  // Scheduling fields (nullable — customer may not have selected)
  pickupDate: varchar("pickup_date", { length: 20 }),
  pickupSlot: varchar("pickup_slot", { length: 50 }),
  // ── Weighing / price adjustment ────────────────────────
  // Customers estimate quantities at checkout; the shop weighs the
  // laundry at AT_SHOP and the price adjusts. Large increases need
  // customer approval before the order can progress.
  originalTotalAmount: integer("original_total_amount"),
  proposedTotalAmount: integer("proposed_total_amount"),
  adjustmentStatus: varchar("adjustment_status", { length: 20 }).notNull().default("NONE"),
  // ── Pickup offer flow ──────────────────────────────────
  // While status is PICKUP_OFFERED, riderId holds the offered rider
  // and offerExpiresAt the deadline; declined riders are excluded
  // from re-offers.
  offerExpiresAt: timestamp("offer_expires_at"),
  declinedRiderIds: jsonb("declined_rider_ids").notNull().default([]),
  // Proof-of-delivery photo URL captured by the rider at handover
  deliveryProofUrl: text("delivery_proof_url"),
  // Client-generated key to dedupe double-submissions (nullable;
  // Postgres unique indexes permit multiple NULLs)
  idempotencyKey: varchar("idempotency_key", { length: 64 }).unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  // Order lists per actor + the sweeper/auto-assign status scans
  customerIdx: index("orders_customer_id_idx").on(t.customerId),
  shopIdx: index("orders_shop_id_idx").on(t.shopId),
  riderIdx: index("orders_rider_id_idx").on(t.riderId),
  statusIdx: index("orders_status_idx").on(t.status),
}));

export const orderItems = pgTable("order_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id),
  serviceId: uuid("service_id")
    .notNull()
    .references(() => services.id),
  serviceName: text("service_name").notNull(),
  price: integer("price").notNull(),
  quantity: integer("quantity").notNull(),
  // Actual measured quantity (kg can be fractional) — null until weighed
  actualQuantity: doublePrecision("actual_quantity"),
}, (t) => ({
  orderIdx: index("order_items_order_id_idx").on(t.orderId),
}));
