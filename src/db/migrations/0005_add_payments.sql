-- 0005_add_payments
-- Payment tracking: one payment per order

-- ── Enums ──────────────────────────────────────────────
CREATE TYPE "public"."payment_method" AS ENUM('COD');
CREATE TYPE "public"."payment_status" AS ENUM('PENDING', 'COLLECTED', 'FAILED');

-- ── Table ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "payments" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_id"   uuid NOT NULL REFERENCES "orders"("id"),
  "amount"     integer NOT NULL,
  "method"     "payment_method" DEFAULT 'COD' NOT NULL,
  "status"     "payment_status" DEFAULT 'PENDING' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "payments_order_id_unique" UNIQUE("order_id")
);
