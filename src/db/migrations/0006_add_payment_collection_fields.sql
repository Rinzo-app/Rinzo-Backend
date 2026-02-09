-- 0006_add_payment_collection_fields
-- Add collected_by and collected_at to payments for COD collection tracking

ALTER TABLE "payments" ADD COLUMN "collected_by" varchar(50);
ALTER TABLE "payments" ADD COLUMN "collected_at" timestamp;
