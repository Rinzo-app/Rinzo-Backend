import { pgTable, uuid, varchar, boolean, doublePrecision, timestamp } from "drizzle-orm/pg-core";
import { riderStatusEnum } from "./enums";
import { users } from "./users";

export const riders = pgTable("riders", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  phone: varchar("phone", { length: 20 }).notNull(),
  vehicleType: varchar("vehicle_type", { length: 50 }).notNull(),
  status: riderStatusEnum("status").notNull().default("PENDING"),
  isAvailable: boolean("is_available").notNull().default(false),

  // ── Geo-location (nullable — rider may not have sent location yet) ──
  lastLat: doublePrecision("last_lat"),
  lastLng: doublePrecision("last_lng"),
  locationUpdatedAt: timestamp("location_updated_at"),
});
