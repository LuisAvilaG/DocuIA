ALTER TABLE "subsidiaries" ADD COLUMN "invoice_format" varchar(10) DEFAULT 'pdf' NOT NULL;--> statement-breakpoint
-- Subsidiarias mexicanas existentes: sus proveedores mandan CFDI.
UPDATE "subsidiaries" SET "invoice_format" = 'cfdi' WHERE "locale" = 'es-MX' OR upper("currency") = 'MXN';
