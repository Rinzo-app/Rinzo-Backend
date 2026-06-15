CREATE TABLE IF NOT EXISTS "plans" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(100) NOT NULL,
  "price" integer NOT NULL,
  "duration_days" integer NOT NULL DEFAULT 30,
  "free_delivery" boolean NOT NULL DEFAULT false,
  "discount_bps" integer NOT NULL DEFAULT 0,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "memberships" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "customer_id" uuid NOT NULL REFERENCES "users"("id"),
  "plan_id" uuid NOT NULL REFERENCES "plans"("id"),
  "status" varchar(20) NOT NULL DEFAULT 'ACTIVE',
  "source" varchar(20) NOT NULL DEFAULT 'ADMIN',
  "starts_at" timestamp DEFAULT now() NOT NULL,
  "expires_at" timestamp NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memberships_customer_id_idx" ON "memberships" ("customer_id");--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "membership_discount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "membership_free_delivery" boolean DEFAULT false NOT NULL;
