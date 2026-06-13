import {
  pgTable,
  uuid,
  varchar,
  text,
  doublePrecision,
  boolean,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";
import { shopStatusEnum } from "./enums.js";
import { users } from "./users.js";

export const shops = pgTable("shops", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id),
  name: varchar("name", { length: 200 }).notNull(),
  phone: varchar("phone", { length: 20 }).notNull(),
  address: text("address").notNull(),
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  status: shopStatusEnum("status").notNull().default("PENDING"),
  isOpen: boolean("is_open").notNull().default(true),
  dailyCapacity: integer("daily_capacity").notNull().default(20),
  autoRejectEnabled: boolean("auto_reject_enabled").notNull().default(false),

  // ── Display fields for Customer app ─────────────────────
  rating: doublePrecision("rating").notNull().default(0),
  totalRatings: integer("total_ratings").notNull().default(0),
  openTime: varchar("open_time", { length: 10 }).notNull().default("08:00"),
  closeTime: varchar("close_time", { length: 10 }).notNull().default("20:00"),
  deliveryFee: integer("delivery_fee").notNull().default(0),
  minOrder: integer("min_order").notNull().default(0),
  // How far (km) the shop will accept pickups/deliveries from
  serviceRadiusKm: integer("service_radius_km").notNull().default(5),

  createdAt: timestamp("created_at").defaultNow().notNull(),
});
