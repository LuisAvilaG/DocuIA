CREATE TABLE "contract_archive_documents" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"organization_id" varchar(36) NOT NULL,
	"case_document_id" varchar(36),
	"storage_key" varchar(500) NOT NULL,
	"original_name" varchar(255) NOT NULL,
	"mime_type" varchar(100) NOT NULL,
	"size_bytes" integer NOT NULL,
	"document_code" varchar(160),
	"normalized_code" varchar(160),
	"document_type" varchar(60),
	"title" varchar(255),
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"page_count" integer,
	"indexed_pages" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"created_by" varchar(36),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_archive_pages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organization_id" varchar(36) NOT NULL,
	"document_id" varchar(36) NOT NULL,
	"page_number" integer NOT NULL,
	"text" text NOT NULL,
	"ocr_mode" varchar(12) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_archive_references" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"organization_id" varchar(36) NOT NULL,
	"source_document_id" varchar(36) NOT NULL,
	"raw_code" varchar(160) NOT NULL,
	"normalized_code" varchar(160) NOT NULL,
	"page_number" integer NOT NULL,
	"context" text NOT NULL,
	"target_document_id" varchar(36),
	"status" varchar(20) DEFAULT 'missing' NOT NULL,
	"assessment" varchar(20),
	"reason" text,
	"reviewed_by" varchar(36),
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_large_uploads" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"organization_id" varchar(36) NOT NULL,
	"created_by" varchar(36) NOT NULL,
	"storage_key" varchar(500) NOT NULL,
	"original_name" varchar(255) NOT NULL,
	"mime_type" varchar(100) NOT NULL,
	"size_bytes" integer NOT NULL,
	"multipart_id" varchar(500) NOT NULL,
	"status" varchar(20) DEFAULT 'uploading' NOT NULL,
	"claimed_by" varchar(60),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX "contract_archive_storage_idx" ON "contract_archive_documents" USING btree ("organization_id","storage_key");--> statement-breakpoint
CREATE INDEX "contract_archive_code_idx" ON "contract_archive_documents" USING btree ("organization_id","normalized_code");--> statement-breakpoint
CREATE INDEX "contract_archive_org_status_idx" ON "contract_archive_documents" USING btree ("organization_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "contract_archive_page_idx" ON "contract_archive_pages" USING btree ("document_id","page_number");--> statement-breakpoint
CREATE INDEX "contract_archive_pages_org_idx" ON "contract_archive_pages" USING btree ("organization_id","document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contract_archive_ref_unique_idx" ON "contract_archive_references" USING btree ("source_document_id","normalized_code");--> statement-breakpoint
CREATE INDEX "contract_archive_ref_code_idx" ON "contract_archive_references" USING btree ("organization_id","normalized_code");--> statement-breakpoint
CREATE INDEX "contract_archive_ref_status_idx" ON "contract_archive_references" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "contract_large_upload_storage_idx" ON "contract_large_uploads" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "contract_large_upload_org_idx" ON "contract_large_uploads" USING btree ("organization_id","created_by","status");
