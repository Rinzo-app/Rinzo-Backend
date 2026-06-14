ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "payout_method" varchar(10);--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "bank_account_name" varchar(120);--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "bank_account_number" varchar(30);--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "bank_ifsc" varchar(15);--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "upi_id" varchar(120);--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "pan_number" varchar(15);--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "gst_number" varchar(20);--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "pan_image_url" text;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "license_image_url" text;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "documents_status" "documents_status" DEFAULT 'NOT_SUBMITTED' NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "documents_rejection_reason" text;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shop_payouts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "shop_id" uuid NOT NULL REFERENCES "shops"("id"),
  "amount" integer NOT NULL,
  "method" varchar(10) NOT NULL,
  "reference" varchar(120),
  "created_by" uuid NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shop_payouts_shop_id_idx" ON "shop_payouts" ("shop_id");
