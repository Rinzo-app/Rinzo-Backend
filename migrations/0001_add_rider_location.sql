-- Migration: Add geo-location columns to riders table
-- Step 8.5 — Geo-aware rider auto-assignment

ALTER TABLE riders
  ADD COLUMN IF NOT EXISTS last_lat       DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS last_lng       DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS location_updated_at TIMESTAMP;
