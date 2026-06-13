DO $$ BEGIN
  CREATE TYPE "documents_status" AS ENUM ('NOT_SUBMITTED', 'SUBMITTED', 'VERIFIED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
ALTER TABLE "riders" ADD COLUMN IF NOT EXISTS "dl_image_url" text;--> statement-breakpoint
ALTER TABLE "riders" ADD COLUMN IF NOT EXISTS "rc_image_url" text;--> statement-breakpoint
ALTER TABLE "riders" ADD COLUMN IF NOT EXISTS "selfie_url" text;--> statement-breakpoint
ALTER TABLE "riders" ADD COLUMN IF NOT EXISTS "documents_status" "documents_status" NOT NULL DEFAULT 'NOT_SUBMITTED';--> statement-breakpoint
ALTER TABLE "riders" ADD COLUMN IF NOT EXISTS "documents_rejection_reason" text;
