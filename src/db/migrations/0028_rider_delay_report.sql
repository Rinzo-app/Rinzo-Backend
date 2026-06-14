ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "delay_reason" varchar(40);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "delay_note" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "delay_reported_at" timestamp;--> statement-breakpoint
ALTER TABLE "platform_settings" ALTER COLUMN "pickup_sla_min" SET DEFAULT 45;--> statement-breakpoint
ALTER TABLE "platform_settings" ALTER COLUMN "delivery_sla_min" SET DEFAULT 60;--> statement-breakpoint
UPDATE "platform_settings" SET "pickup_sla_min" = 45 WHERE "pickup_sla_min" = 30;--> statement-breakpoint
UPDATE "platform_settings" SET "delivery_sla_min" = 60 WHERE "delivery_sla_min" = 45;
