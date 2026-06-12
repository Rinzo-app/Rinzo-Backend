ALTER TYPE "payment_method" ADD VALUE IF NOT EXISTS 'UPI';--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "provider" varchar(30);--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "provider_order_id" varchar(80);
