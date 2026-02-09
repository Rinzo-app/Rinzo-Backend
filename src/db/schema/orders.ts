import { pgTable, uuid, jsonb, integer, text, doublePrecision, timestamp } from "drizzle-orm/pg-core";
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
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

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
});
