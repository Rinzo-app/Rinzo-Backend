ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "original_total_amount" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "proposed_total_amount" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "adjustment_status" varchar(20) NOT NULL DEFAULT 'NONE';--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "actual_quantity" double precision;
