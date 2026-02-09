-- 0008_add_refunds_and_ledger_reversals
-- Refunds table + new ledger_reason values for reversals

-- ── Enums ──────────────────────────────────────────────
CREATE TYPE "public"."refund_status" AS ENUM('PROCESSED');
CREATE TYPE "public"."refund_reason" AS ENUM('ORDER_CANCELLED', 'ADMIN_DISCRETION');

-- Extend ledger_reason with reversal values
ALTER TYPE "public"."ledger_reason" ADD VALUE 'COMMISSION_REFUND';
ALTER TYPE "public"."ledger_reason" ADD VALUE 'EARNING_REVERSAL';

-- ── Refunds table ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS "refunds" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_id"   uuid NOT NULL REFERENCES "orders"("id"),
  "payment_id" uuid NOT NULL REFERENCES "payments"("id"),
  "amount"     integer NOT NULL,
  "reason"     "refund_reason" NOT NULL,
  "status"     "refund_status" DEFAULT 'PROCESSED' NOT NULL,
  "note"       text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "refunds_payment_id_unique" UNIQUE("payment_id")
);
