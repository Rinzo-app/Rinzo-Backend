-- 0007_add_ledger_and_platform_fee
-- Ledger entries for platform economics + platformFee on orders

-- ── Enums ──────────────────────────────────────────────
CREATE TYPE "public"."ledger_entity_type" AS ENUM('PLATFORM', 'SHOP', 'RIDER');
CREATE TYPE "public"."ledger_reason" AS ENUM('PLATFORM_FEE', 'COMMISSION', 'EARNING');

-- ── Orders: add platform_fee column ────────────────────
ALTER TABLE "orders" ADD COLUMN "platform_fee" integer NOT NULL DEFAULT 0;

-- ── Ledger entries table ───────────────────────────────
CREATE TABLE IF NOT EXISTS "ledger_entries" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "entity_type" "ledger_entity_type" NOT NULL,
  "entity_id"   uuid,
  "order_id"    uuid NOT NULL REFERENCES "orders"("id"),
  "amount"      integer NOT NULL,
  "reason"      "ledger_reason" NOT NULL,
  "created_at"  timestamp DEFAULT now() NOT NULL
);
