ALTER TABLE "platform_settings" ADD COLUMN IF NOT EXISTS "pickup_sla_min" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN IF NOT EXISTS "delivery_sla_min" integer DEFAULT 45 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "sla_breached_at" timestamp;
