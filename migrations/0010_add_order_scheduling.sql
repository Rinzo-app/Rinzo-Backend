-- Add scheduling fields to orders table
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_date VARCHAR(20);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_slot VARCHAR(50);
