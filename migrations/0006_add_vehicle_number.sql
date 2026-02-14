-- Add vehicle_number column to riders table
ALTER TABLE riders ADD COLUMN vehicle_number VARCHAR(30) DEFAULT '' NOT NULL;
