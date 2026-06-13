CREATE TABLE IF NOT EXISTS "platform_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "delivery_rate_per_km" integer DEFAULT 1000 NOT NULL,
  "min_delivery_fee" integer DEFAULT 1000 NOT NULL,
  "fallback_delivery_fee" integer DEFAULT 2000 NOT NULL,
  "rider_payout_per_km" integer DEFAULT 700 NOT NULL,
  "platform_fee" integer DEFAULT 1000 NOT NULL,
  "commission_bps" integer DEFAULT 1000 NOT NULL,
  "placed_timeout_min" integer DEFAULT 60 NOT NULL,
  "no_rider_timeout_min" integer DEFAULT 60 NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
-- Seed exactly one row with the current defaults if the table is empty.
INSERT INTO "platform_settings" ("delivery_rate_per_km")
SELECT 1000 WHERE NOT EXISTS (SELECT 1 FROM "platform_settings");--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;
