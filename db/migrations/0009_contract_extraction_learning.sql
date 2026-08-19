CREATE TABLE "contract_extraction_learnings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organization_id" varchar(36) NOT NULL,
	"document_type" varchar(60) NOT NULL,
	"field_key" varchar(80) NOT NULL,
	"original_value" text,
	"corrected_value" text NOT NULL,
	"citation" text,
	"created_by" varchar(36),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "contract_learning_org_type_idx" ON "contract_extraction_learnings" USING btree ("organization_id", "document_type", "field_key");
--> statement-breakpoint
CREATE INDEX "contract_learning_org_active_idx" ON "contract_extraction_learnings" USING btree ("organization_id", "is_active");
