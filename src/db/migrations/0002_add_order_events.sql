CREATE TABLE IF NOT EXISTS "order_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_id" uuid NOT NULL,
  "from_status" "order_status",
  "to_status" "order_status" NOT NULL,
  "actor" varchar(20) NOT NULL,
  "actor_id" uuid NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "order_events"
  ADD CONSTRAINT "order_events_order_id_orders_id_fk"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;
