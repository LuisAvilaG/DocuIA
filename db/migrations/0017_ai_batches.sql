CREATE TABLE "ai_batch_items" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organization_id" varchar(36) NOT NULL,
	"document_id" integer NOT NULL,
	"batch_id" varchar(80),
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"job_json" json NOT NULL,
	"result_json" json,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_batches" (
	"id" varchar(80) PRIMARY KEY NOT NULL,
	"organization_id" varchar(36) NOT NULL,
	"provider" varchar(20) NOT NULL,
	"model" varchar(60) NOT NULL,
	"status" varchar(20) DEFAULT 'submitted' NOT NULL,
	"item_count" integer DEFAULT 0 NOT NULL,
	"counts_json" json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp
);
--> statement-breakpoint
CREATE INDEX "ai_batch_items_org_status_idx" ON "ai_batch_items" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "ai_batch_items_batch_idx" ON "ai_batch_items" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "ai_batches_org_idx" ON "ai_batches" USING btree ("organization_id","status");