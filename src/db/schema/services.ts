import { pgTable, uuid, varchar, integer, boolean } from "drizzle-orm/pg-core";
import { pricingTypeEnum } from "./enums";
import { shops } from "./shops";

export const services = pgTable("services", {
  id: uuid("id").defaultRandom().primaryKey(),
  shopId: uuid("shop_id")
    .notNull()
    .references(() => shops.id),
  name: varchar("name", { length: 200 }).notNull(),
  price: integer("price").notNull(),
  pricingType: pricingTypeEnum("pricing_type").notNull(),
  isActive: boolean("is_active").notNull().default(true),
});
