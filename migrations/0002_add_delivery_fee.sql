-- Migration: Add delivery_fee column to orders table
-- Delivery fee (paise) — nullable with default 0, safe for existing rows

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS delivery_fee INTEGER DEFAULT 0;
