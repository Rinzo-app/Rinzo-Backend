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
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
