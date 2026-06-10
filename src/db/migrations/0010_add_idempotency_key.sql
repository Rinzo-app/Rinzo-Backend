-- 0010_add_idempotency_key
-- Client-generated key to dedupe double-submitted orders.
-- Unique index permits multiple NULLs, so older orders are unaffected.

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "idempotency_key" varchar(64);
CREATE UNIQUE INDEX IF NOT EXISTS "orders_idempotency_key_unique" ON "orders" ("idempotency_key");
