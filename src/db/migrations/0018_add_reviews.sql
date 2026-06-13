CREATE TABLE IF NOT EXISTS "reviews" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_id" uuid NOT NULL UNIQUE REFERENCES "orders"("id"),
  "shop_id" uuid NOT NULL REFERENCES "shops"("id"),
  "customer_id" uuid NOT NULL REFERENCES "users"("id"),
  "rating" integer NOT NULL,
  "comment" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reviews_shop_id_idx" ON "reviews" ("shop_id");
