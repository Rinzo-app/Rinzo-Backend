CREATE TYPE "public"."user_role" AS ENUM('CUSTOMER', 'SHOP_OWNER', 'RIDER', 'ADMIN');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('PENDING', 'ACTIVE', 'SUSPENDED');--> statement-breakpoint
CREATE TYPE "public"."shop_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED');--> statement-breakpoint
CREATE TYPE "public"."pricing_type" AS ENUM('PER_KG', 'PER_ITEM');--> statement-breakpoint
CREATE TYPE "public"."rider_status" AS ENUM('PENDING', 'APPROVED', 'ACTIVE', 'SUSPENDED');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('PLACED', 'SHOP_ACCEPTED', 'PICKUP_ASSIGNED', 'PICKED_UP_FROM_CUSTOMER', 'AT_SHOP', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'REJECTED_BY_SHOP');--> statement-breakpoint
CREATE TYPE "public"."dispute_raised_by" AS ENUM('CUSTOMER', 'SHOP', 'RIDER');--> statement-breakpoint
CREATE TYPE "public"."dispute_status" AS ENUM('OPEN', 'IN_REVIEW', 'RESOLVED', 'CLOSED');--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role" "user_role" NOT NULL,
	"name" varchar(150) NOT NULL,
	"phone" varchar(20),
	"email" varchar(255),
	"status" "user_status" DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"phone" varchar(20) NOT NULL,
	"address" text NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"status" "shop_status" DEFAULT 'PENDING' NOT NULL,
	"is_open" boolean DEFAULT true NOT NULL,
	"daily_capacity" integer DEFAULT 20 NOT NULL,
	"auto_reject_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"price" integer NOT NULL,
	"pricing_type" "pricing_type" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "riders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"phone" varchar(20) NOT NULL,
	"vehicle_type" varchar(50) NOT NULL,
	"status" "rider_status" DEFAULT 'PENDING' NOT NULL,
	"is_available" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"rider_id" uuid,
	"items" jsonb NOT NULL,
	"total_amount" integer NOT NULL,
	"status" "order_status" DEFAULT 'PLACED' NOT NULL,
	"pickup_address" text NOT NULL,
	"delivery_address" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"service_name" text NOT NULL,
	"price" integer NOT NULL,
	"quantity" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"raised_by_type" "dispute_raised_by" NOT NULL,
	"raised_by_id" uuid NOT NULL,
	"order_id" uuid,
	"category" varchar(100) NOT NULL,
	"description" text NOT NULL,
	"status" "dispute_status" DEFAULT 'OPEN' NOT NULL,
	"admin_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "riders" ADD CONSTRAINT "riders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_rider_id_riders_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."riders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;
