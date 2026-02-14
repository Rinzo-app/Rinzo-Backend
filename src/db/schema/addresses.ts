import {
  pgTable,
  uuid,
  varchar,
  text,
  doublePrecision,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";

export const addresses = pgTable("addresses", {
  id: uuid("id").defaultRandom().primaryKey(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => users.id),
  label: varchar("label", { length: 50 }).notNull(),
  addressLine: text("address_line").notNull(),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});
