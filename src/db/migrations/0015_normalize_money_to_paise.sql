-- Money-units normalization: service prices were entered through the
-- apps as whole RUPEES while platform/delivery fees and the rider
-- ledger were already PAISE, so totals mixed units. The platform
-- convention is integer paise everywhere; multiply all legacy
-- rupee-valued rows by 100. (Apps convert at the input/display edge
-- from this release on.)
UPDATE "services" SET "price" = "price" * 100;--> statement-breakpoint
UPDATE "order_items" SET "price" = "price" * 100;--> statement-breakpoint
UPDATE "orders" SET
  "total_amount" = "total_amount" * 100,
  "original_total_amount" = "original_total_amount" * 100,
  "proposed_total_amount" = "proposed_total_amount" * 100;--> statement-breakpoint
UPDATE "orders" SET "items" = (
  SELECT jsonb_agg(jsonb_set(e, '{price}', to_jsonb(((e->>'price')::numeric * 100)::int)))
  FROM jsonb_array_elements("items") e
) WHERE jsonb_typeof("items") = 'array' AND jsonb_array_length("items") > 0;--> statement-breakpoint
UPDATE "payments" p SET "amount" = o."total_amount" + o."platform_fee" + o."delivery_fee"
FROM "orders" o WHERE o."id" = p."order_id";
