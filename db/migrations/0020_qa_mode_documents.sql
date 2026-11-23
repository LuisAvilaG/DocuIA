ALTER TABLE "history_documents" ADD COLUMN "is_qa" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "history_documents" ADD COLUMN "qa_sends" json;