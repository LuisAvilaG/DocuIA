ALTER TABLE "contract_validations" ADD COLUMN "rule_name" varchar(150);--> statement-breakpoint
ALTER TABLE "contract_validations" ADD COLUMN "severity" varchar(10);--> statement-breakpoint
ALTER TABLE "contract_validations" ADD COLUMN "ok" boolean;