ALTER TABLE "ns_connections" ADD COLUMN "provider" varchar(32) DEFAULT 'netsuite' NOT NULL;--> statement-breakpoint
ALTER TABLE "ns_connections" ADD COLUMN "provider_config" text;