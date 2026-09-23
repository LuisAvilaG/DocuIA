CREATE TYPE "public"."vendor_rule_scope" AS ENUM('default', 'category', 'vendor');--> statement-breakpoint
ALTER TYPE "public"."document_status" ADD VALUE IF NOT EXISTS 'awaiting_receipt';--> statement-breakpoint
CREATE TABLE "vendor_rules" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"organization_id" varchar(36) NOT NULL,
	"scope" "vendor_rule_scope" NOT NULL,
	"target_key" varchar(64) NOT NULL,
	"target_label" varchar(255),
	"config" json NOT NULL,
	"created_by" varchar(36),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "catalog_vendors" ADD COLUMN "category_id" varchar(64);--> statement-breakpoint
ALTER TABLE "catalog_vendors" ADD COLUMN "category_name" varchar(191);--> statement-breakpoint
ALTER TABLE "subsidiaries" ADD COLUMN "tax_id" varchar(20);--> statement-breakpoint
ALTER TABLE "history_documents" ADD COLUMN "po_internal_id" varchar(64);--> statement-breakpoint
ALTER TABLE "history_documents" ADD COLUMN "cfdi_uuid" varchar(40);--> statement-breakpoint
ALTER TABLE "history_documents" ADD COLUMN "attachment_key" text;--> statement-breakpoint
ALTER TABLE "history_documents" ADD COLUMN "awaiting_since" timestamp;--> statement-breakpoint
ALTER TABLE "history_documents" ADD COLUMN "next_receipt_check_at" timestamp;--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_rules_target_idx" ON "vendor_rules" USING btree ("organization_id","scope","target_key");--> statement-breakpoint
CREATE INDEX "vendor_rules_org_idx" ON "vendor_rules" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "history_docs_cfdi_uuid_idx" ON "history_documents" USING btree ("organization_id","cfdi_uuid");--> statement-breakpoint
CREATE INDEX "history_docs_receipt_check_idx" ON "history_documents" USING btree ("status","next_receipt_check_at");