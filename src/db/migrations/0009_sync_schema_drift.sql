-- 0009_sync_schema_drift
-- Catch-up migration: these tables/columns exist in the Drizzle schema
-- files (and are used by the code) but were never captured in a migration —
-- the old database was synced out-of-band (drizzle-kit push). Recreating
-- the DB from migrations alone left them missing.
-- All statements are guarded so this is safe to run on a DB that already
-- has some of these objects.

-- ── orders: delivery fee, customer coords, scheduling ──
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "delivery_fee" integer NOT NULL DEFAULT 0;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "pickup_lat" double precision;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "pickup_lng" double precision;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "pickup_date" varchar(20);
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "pickup_slot" varchar(50);

-- ── riders: vehicle number + last known location ──
ALTER TABLE "riders" ADD COLUMN IF NOT EXISTS "vehicle_number" varchar(30) NOT NULL DEFAULT '';
ALTER TABLE "riders" ADD COLUMN IF NOT EXISTS "last_lat" double precision;
ALTER TABLE "riders" ADD COLUMN IF NOT EXISTS "last_lng" double precision;
ALTER TABLE "riders" ADD COLUMN IF NOT EXISTS "location_updated_at" timestamp;

-- ── shops: customer-facing display fields ──
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "rating" double precision NOT NULL DEFAULT 0;
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "total_ratings" integer NOT NULL DEFAULT 0;
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "open_time" varchar(10) NOT NULL DEFAULT '08:00';
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "close_time" varchar(10) NOT NULL DEFAULT '20:00';
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "delivery_fee" integer NOT NULL DEFAULT 0;
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "min_order" integer NOT NULL DEFAULT 0;

-- ── ledger_entries: optional metadata (payout leg, distance, rate) ──
ALTER TABLE "ledger_entries" ADD COLUMN IF NOT EXISTS "details" jsonb;

-- ── disputes: resolution text + updated_at ──
ALTER TABLE "disputes" ADD COLUMN IF NOT EXISTS "resolution" text;
ALTER TABLE "disputes" ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now();

-- ── addresses: customer saved addresses ──
CREATE TABLE IF NOT EXISTS "addresses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "customer_id" uuid NOT NULL REFERENCES "users"("id"),
  "label" varchar(50) NOT NULL,
  "address_line" text NOT NULL,
  "lat" double precision,
  "lng" double precision,
  "is_default" boolean NOT NULL DEFAULT false,
  "created_at" timestamp DEFAULT now()
);

-- ── favorites: customer ↔ shop favourites ──
CREATE TABLE IF NOT EXISTS "favorites" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "customer_id" uuid NOT NULL REFERENCES "users"("id"),
  "shop_id" uuid NOT NULL REFERENCES "shops"("id"),
  "created_at" timestamp DEFAULT now(),
  CONSTRAINT "favorites_customer_id_shop_id_unique" UNIQUE("customer_id", "shop_id")
);
