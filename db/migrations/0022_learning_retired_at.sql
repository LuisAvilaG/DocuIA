ALTER TABLE "contract_extraction_learnings" ADD COLUMN "retired_at" timestamp;--> statement-breakpoint
-- Los aprendizajes que se «retiraron» antes quedan retirados (no en pausa).
UPDATE "contract_extraction_learnings" SET "retired_at" = now() WHERE "is_active" = false;
