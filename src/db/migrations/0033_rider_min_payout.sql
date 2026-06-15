ALTER TABLE "platform_settings" ADD COLUMN IF NOT EXISTS "rider_min_payout" integer DEFAULT 2000 NOT NULL;
