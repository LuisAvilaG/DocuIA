CREATE TABLE "contract_visual_training_variants" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"organization_id" varchar(36) NOT NULL,
	"flow_id" varchar(36) NOT NULL,
	"document_type" varchar(60) NOT NULL,
	"name" varchar(150) NOT NULL,
	"storage_key" varchar(500) NOT NULL,
	"original_name" varchar(255),
	"mime_type" varchar(100),
	"signature_text" text,
	"mappings_json" json NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "contract_visual_variant_flow_idx" ON "contract_visual_training_variants" USING btree ("organization_id","flow_id","document_type");
--> statement-breakpoint
CREATE INDEX "contract_visual_variant_active_idx" ON "contract_visual_training_variants" USING btree ("organization_id","is_active");
