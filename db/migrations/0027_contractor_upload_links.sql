CREATE TABLE "contract_upload_links" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"organization_id" varchar(36) NOT NULL,
	"case_id" varchar(36) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"documents_json" json,
	"reason" text,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"revoked_at" timestamp,
	"files_json" json,
	"created_by" varchar(36),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "contract_upload_links_token_idx" ON "contract_upload_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "contract_upload_links_case_idx" ON "contract_upload_links" USING btree ("case_id");