-- Performance indexes on the hot query paths (browse, order lists,
-- offer-sweeper/auto-assign status scans, rider lookups). All additive
-- and idempotent; payments.order_id and reviews.order_id are already
-- unique (indexed), so they're omitted.
CREATE INDEX IF NOT EXISTS "shops_status_idx" ON "shops" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shops_owner_id_idx" ON "shops" ("owner_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "services_shop_id_idx" ON "services" ("shop_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_customer_id_idx" ON "orders" ("customer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_shop_id_idx" ON "orders" ("shop_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_rider_id_idx" ON "orders" ("rider_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_status_idx" ON "orders" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_items_order_id_idx" ON "order_items" ("order_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_events_order_id_idx" ON "order_events" ("order_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reviews_shop_id_idx" ON "reviews" ("shop_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "riders_user_id_idx" ON "riders" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "riders_status_idx" ON "riders" ("status");
