-- 0011_add_push_tokens
-- Expo push notification tokens, one row per device install.

CREATE TABLE IF NOT EXISTS "push_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "token" varchar(200) NOT NULL,
  "platform" varchar(20) NOT NULL DEFAULT 'unknown',
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "push_tokens_token_unique" UNIQUE("token")
);

CREATE INDEX IF NOT EXISTS "push_tokens_user_id_idx" ON "push_tokens" ("user_id");
