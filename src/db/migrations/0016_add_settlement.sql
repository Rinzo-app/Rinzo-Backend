ALTER TYPE "payment_status" ADD VALUE IF NOT EXISTS 'SETTLED' AFTER 'COLLECTED';--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "settled_at" timestamp;
