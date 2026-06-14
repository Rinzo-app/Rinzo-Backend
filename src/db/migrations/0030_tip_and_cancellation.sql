ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "tip_amount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN IF NOT EXISTS "cancellation_fee" integer DEFAULT 0 NOT NULL;
