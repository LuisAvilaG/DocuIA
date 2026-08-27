CREATE TABLE "contract_ai_analysis_results" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"case_id" varchar(36) NOT NULL,
	"rule_name" varchar(150) NOT NULL,
	"severity" varchar(10) NOT NULL,
	"output_mode" varchar(16) NOT NULL,
	"outcome" varchar(16) NOT NULL,
	"summary" text,
	"items_json" json,
	"citations_json" json,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_ai_analysis_templates" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"organization_id" varchar(36) NOT NULL,
	"name" varchar(150) NOT NULL,
	"description" text,
	"config_json" json NOT NULL,
	"created_by" varchar(36),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX "contract_ai_results_case_idx" ON "contract_ai_analysis_results" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "contract_ai_templates_org_idx" ON "contract_ai_analysis_templates" USING btree ("organization_id","updated_at");
