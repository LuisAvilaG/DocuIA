CREATE TABLE "contract_flow_versions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organization_id" varchar(36) NOT NULL,
	"flow_id" varchar(36) NOT NULL,
	"version" integer NOT NULL,
	"name" varchar(150) NOT NULL,
	"graph_json" json NOT NULL,
	"note" text,
	"changes_json" json,
	"published_by" varchar(36),
	"published_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contract_flows" ADD COLUMN "draft_json" json;--> statement-breakpoint
ALTER TABLE "contract_flows" ADD COLUMN "draft_updated_at" timestamp;--> statement-breakpoint
CREATE UNIQUE INDEX "contract_flow_versions_flow_version_idx" ON "contract_flow_versions" USING btree ("flow_id","version");--> statement-breakpoint
CREATE INDEX "contract_flow_versions_org_idx" ON "contract_flow_versions" USING btree ("organization_id");--> statement-breakpoint
-- El historial empieza con la versión vigente de cada flujo.
INSERT INTO "contract_flow_versions" ("organization_id", "flow_id", "version", "name", "graph_json", "note") SELECT "organization_id", "id", "version", "name", "graph_json", 'Versión vigente al activar el historial' FROM "contract_flows";
