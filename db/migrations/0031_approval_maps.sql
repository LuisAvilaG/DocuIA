CREATE TABLE "approval_absences" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"organization_id" varchar(36) NOT NULL,
	"user_id" varchar(36) NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"created_by" varchar(36),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_maps" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"organization_id" varchar(36) NOT NULL,
	"name" varchar(150) NOT NULL,
	"draft_json" json NOT NULL,
	"published_json" json,
	"version" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp,
	"published_by" varchar(36),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_role_members" (
	"role_id" varchar(36) NOT NULL,
	"user_id" varchar(36) NOT NULL,
	"organization_id" varchar(36) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_roles" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"organization_id" varchar(36) NOT NULL,
	"name" varchar(120) NOT NULL,
	"substitute_user_id" varchar(36),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contract_flows" ADD COLUMN "approval_map_id" varchar(36);--> statement-breakpoint
CREATE INDEX "approval_absences_org_idx" ON "approval_absences" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "approval_maps_org_idx" ON "approval_maps" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_role_members_role_user_idx" ON "approval_role_members" USING btree ("role_id","user_id");--> statement-breakpoint
CREATE INDEX "approval_role_members_org_idx" ON "approval_role_members" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "approval_roles_org_idx" ON "approval_roles" USING btree ("organization_id");