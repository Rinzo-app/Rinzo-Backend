-- Create admin_events audit table
CREATE TABLE IF NOT EXISTS "admin_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "admin_id" uuid NOT NULL REFERENCES "users"("id"),
  "action" varchar(100) NOT NULL,
  "target_type" varchar(50) NOT NULL,
  "target_id" uuid NOT NULL,
  "details" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);
