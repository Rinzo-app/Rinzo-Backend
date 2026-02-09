-- Migration: Add details JSONB column to ledger_entries
-- Used to store per-entry metadata (e.g. leg type, distance, rate)

ALTER TABLE ledger_entries
  ADD COLUMN IF NOT EXISTS details JSONB;
