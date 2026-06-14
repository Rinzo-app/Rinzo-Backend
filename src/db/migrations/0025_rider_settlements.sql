CREATE TABLE IF NOT EXISTS "rider_settlements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "rider_id" uuid NOT NULL REFERENCES "riders"("id"),
  "amount" integer NOT NULL,
  "cash_collected" integer NOT NULL,
  "method" varchar(10) NOT NULL,
  "status" varchar(10) DEFAULT 'PENDING' NOT NULL,
  "covered_payment_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "provider" varchar(30),
  "provider_order_id" varchar(80),
  "created_by" varchar(10) NOT NULL,
  "verified_by" uuid,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "paid_at" timestamp
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rider_settlements_rider_id_idx" ON "rider_settlements" ("rider_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rider_settlements_status_idx" ON "rider_settlements" ("status");
