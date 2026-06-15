ALTER TABLE "reviews" ADD COLUMN IF NOT EXISTS "rider_id" uuid REFERENCES "riders"("id");--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN IF NOT EXISTS "rider_rating" integer;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reviews_rider_id_idx" ON "reviews" ("rider_id");--> statement-breakpoint
ALTER TABLE "riders" ADD COLUMN IF NOT EXISTS "rating" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "riders" ADD COLUMN IF NOT EXISTS "total_ratings" integer DEFAULT 0 NOT NULL;
