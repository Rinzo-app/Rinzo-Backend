-- Add nullable, unique firebase_uid column to users table
ALTER TABLE "users" ADD COLUMN "firebase_uid" varchar(128);--> statement-breakpoint
CREATE UNIQUE INDEX "users_firebase_uid_unique" ON "users" USING btree ("firebase_uid");
