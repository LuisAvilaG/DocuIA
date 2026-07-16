CREATE TYPE "public"."contract_case_status" AS ENUM('uploaded', 'processing', 'review', 'validated', 'generated', 'failed');--> statement-breakpoint
CREATE TYPE "public"."contract_ocr_mode" AS ENUM('digital', 'scanned', 'mixed');--> statement-breakpoint
CREATE TABLE "contract_cases" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"organization_id" varchar(36) NOT NULL,
	"title" varchar(255),
	"status" "contract_case_status" DEFAULT 'uploaded' NOT NULL,
	"created_by" varchar(36),
	"result_json" json,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_doc_types" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organization_id" varchar(36) NOT NULL,
	"key" varchar(60) NOT NULL,
	"name" varchar(150) NOT NULL,
	"classification_hint" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_documents" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"case_id" varchar(36) NOT NULL,
	"storage_key" varchar(500) NOT NULL,
	"original_name" varchar(255),
	"mime_type" varchar(100),
	"detected_type" varchar(60),
	"ocr_mode" "contract_ocr_mode",
	"detected_text" text,
	"extracted_json" json,
	"citations_json" json,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_field_schemas" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organization_id" varchar(36) NOT NULL,
	"doc_type_key" varchar(60) NOT NULL,
	"field_key" varchar(80) NOT NULL,
	"label" varchar(150) NOT NULL,
	"field_type" varchar(30) DEFAULT 'string' NOT NULL,
	"is_list" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_obligations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"case_id" varchar(36) NOT NULL,
	"type" varchar(60),
	"description" text,
	"due_date" timestamp,
	"alert_at" timestamp,
	"status" varchar(30) DEFAULT 'open' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_output_templates" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organization_id" varchar(36) NOT NULL,
	"key" varchar(60) NOT NULL,
	"name" varchar(150) NOT NULL,
	"body" text NOT NULL,
	"letterhead_asset" varchar(255),
	"mapping_json" json,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_validation_rules" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organization_id" varchar(36) NOT NULL,
	"name" varchar(150) NOT NULL,
	"applies_to" varchar(60) NOT NULL,
	"conditions_json" json NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_validations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"case_id" varchar(36) NOT NULL,
	"subject" varchar(255) NOT NULL,
	"status" varchar(40) NOT NULL,
	"reason" text,
	"checks_json" json,
	"citation" text
);
--> statement-breakpoint
CREATE INDEX "contract_cases_org_idx" ON "contract_cases" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "contract_cases_status_idx" ON "contract_cases" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "contract_doc_types_org_key_idx" ON "contract_doc_types" USING btree ("organization_id","key");--> statement-breakpoint
CREATE INDEX "contract_doc_types_org_idx" ON "contract_doc_types" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "contract_documents_case_idx" ON "contract_documents" USING btree ("case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contract_field_org_type_field_idx" ON "contract_field_schemas" USING btree ("organization_id","doc_type_key","field_key");--> statement-breakpoint
CREATE INDEX "contract_field_org_idx" ON "contract_field_schemas" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "contract_obligations_case_idx" ON "contract_obligations" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "contract_obligations_alert_idx" ON "contract_obligations" USING btree ("alert_at");--> statement-breakpoint
CREATE UNIQUE INDEX "contract_tmpl_org_key_idx" ON "contract_output_templates" USING btree ("organization_id","key");--> statement-breakpoint
CREATE INDEX "contract_tmpl_org_idx" ON "contract_output_templates" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "contract_rules_org_idx" ON "contract_validation_rules" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "contract_validations_case_idx" ON "contract_validations" USING btree ("case_id");