ALTER TABLE "exception_queue" ADD COLUMN "document_id" bigint;--> statement-breakpoint
CREATE INDEX "exceptions_document_idx" ON "exception_queue" USING btree ("document_id");