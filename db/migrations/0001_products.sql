CREATE TYPE "public"."org_product_status" AS ENUM('active', 'trial', 'disabled');--> statement-breakpoint
CREATE TABLE "org_products" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organization_id" varchar(36) NOT NULL,
	"product_key" varchar(40) NOT NULL,
	"status" "org_product_status" DEFAULT 'active' NOT NULL,
	"config_json" json,
	"enabled_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"key" varchar(40) PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text,
	"icon" varchar(60),
	"requires_integration" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "features" ADD COLUMN "product_key" varchar(40);--> statement-breakpoint
CREATE UNIQUE INDEX "org_products_org_product_idx" ON "org_products" USING btree ("organization_id","product_key");--> statement-breakpoint
CREATE INDEX "org_products_org_idx" ON "org_products" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "features_product_idx" ON "features" USING btree ("product_key");