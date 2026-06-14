import { pgTable, uuid, integer, timestamp } from "drizzle-orm/pg-core";

// ─────────────────────────────────────────────────────────
// Single-row operator configuration (pricing + timeouts).
// The admin edits these instead of needing a code deploy.
// All money is in paise; commission is basis points (1000 = 10%).
// ─────────────────────────────────────────────────────────
export const platformSettings = pgTable("platform_settings", {
  id: uuid("id").defaultRandom().primaryKey(),
  // Customer-facing delivery fee = round-trip km × rate, floored at min;
  // fallback charged when no GPS.
  deliveryRatePerKm: integer("delivery_rate_per_km").notNull().default(1000),
  minDeliveryFee: integer("min_delivery_fee").notNull().default(1000),
  fallbackDeliveryFee: integer("fallback_delivery_fee").notNull().default(2000),
  // Rider earns this per km (one-way per leg).
  riderPayoutPerKm: integer("rider_payout_per_km").notNull().default(700),
  // Flat platform fee per order + commission on item total (basis points).
  platformFee: integer("platform_fee").notNull().default(1000),
  commissionBps: integer("commission_bps").notNull().default(1000),
  // Auto-cancel timeouts (minutes): shop never accepts / no rider found.
  placedTimeoutMin: integer("placed_timeout_min").notNull().default(60),
  noRiderTimeoutMin: integer("no_rider_timeout_min").notNull().default(60),
  // Rider SLA timeouts (minutes):
  //  - pickupSlaMin: a rider who accepts a pickup but hasn't collected
  //    within this window is auto-unassigned and the order re-offered.
  //  - deliverySlaMin: a rider carrying goods (to shop, or out for
  //    delivery) past this window flags the order for admin review.
  pickupSlaMin: integer("pickup_sla_min").notNull().default(45),
  deliverySlaMin: integer("delivery_sla_min").notNull().default(60),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
