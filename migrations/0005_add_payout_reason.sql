-- Add PAYOUT to ledger_reason enum
ALTER TYPE ledger_reason ADD VALUE IF NOT EXISTS 'PAYOUT';

-- Make order_id nullable (PAYOUT entries have no associated order)
ALTER TABLE ledger_entries ALTER COLUMN order_id DROP NOT NULL;
