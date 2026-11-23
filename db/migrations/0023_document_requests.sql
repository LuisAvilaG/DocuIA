ALTER TYPE "public"."contract_case_status" ADD VALUE 'awaiting_documents';--> statement-breakpoint
ALTER TABLE "contract_cases" ADD COLUMN "contractor_email" varchar(191);