CREATE TYPE "public"."rejection_reason" AS ENUM('CAPACITY_FULL', 'CLOSED_TEMPORARILY', 'SERVICE_UNAVAILABLE', 'EMERGENCY');--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "rejection_reason" "rejection_reason";--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;
