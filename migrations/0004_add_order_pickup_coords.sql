-- Migration: Add customer coordinate columns to orders table
-- Used for accurate geo-based rider payout distance calculation

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS pickup_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS pickup_lng DOUBLE PRECISION;
