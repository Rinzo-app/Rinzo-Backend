import { pgTable, uuid, varchar, integer, boolean, text } from "drizzle-orm/pg-core";
import { pricingTypeEnum } from "./enums.js";
import { shops } from "./shops.js";

export const services = pgTable("services", {
  id: uuid("id").defaultRandom().primaryKey(),
  shopId: uuid("shop_id")
    .notNull()
    .references(() => shops.id),
  name: varchar("name", { length: 200 }).notNull(),
  price: integer("price").notNull(),
  pricingType: pricingTypeEnum("pricing_type").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  // Optional photo shown in the customer shop-detail service list
  imageUrl: text("image_url"),
});
