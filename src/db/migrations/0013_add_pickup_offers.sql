ALTER TYPE "order_status" ADD VALUE IF NOT EXISTS 'PICKUP_OFFERED' BEFORE 'PICKUP_ASSIGNED';--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "offer_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "declined_rider_ids" jsonb NOT NULL DEFAULT '[]'::jsonb;
