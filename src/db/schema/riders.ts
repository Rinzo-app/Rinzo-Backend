import { pgTable, uuid, varchar, boolean, doublePrecision, timestamp, text, index } from "drizzle-orm/pg-core";
import { riderStatusEnum, documentsStatusEnum } from "./enums.js";
import { users } from "./users.js";

export const riders = pgTable("riders", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  phone: varchar("phone", { length: 20 }).notNull(),
  vehicleType: varchar("vehicle_type", { length: 50 }).notNull(),
  vehicleNumber: varchar("vehicle_number", { length: 30 }).notNull().default(""),
  licenseNumber: varchar("license_number", { length: 30 }).notNull().default(""),
  status: riderStatusEnum("status").notNull().default("PENDING"),
  isAvailable: boolean("is_available").notNull().default(false),

  // ── KYC documents (image URLs in Firebase Storage) ──────
  dlImageUrl: text("dl_image_url"),
  rcImageUrl: text("rc_image_url"),
  selfieUrl: text("selfie_url"),
  documentsStatus: documentsStatusEnum("documents_status").notNull().default("NOT_SUBMITTED"),
  documentsRejectionReason: text("documents_rejection_reason"),

  // ── Geo-location (nullable — rider may not have sent location yet) ──
  lastLat: doublePrecision("last_lat"),
  lastLng: doublePrecision("last_lng"),
  locationUpdatedAt: timestamp("location_updated_at"),
}, (t) => ({
  // getRiderForUser on every rider request; auto-assign scans by status
  userIdx: index("riders_user_id_idx").on(t.userId),
  statusIdx: index("riders_status_idx").on(t.status),
}));
