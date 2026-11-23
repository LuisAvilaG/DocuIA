CREATE TABLE "status_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organization_id" varchar(36) NOT NULL,
	"entity" varchar(20) NOT NULL,
	"entity_id" varchar(36) NOT NULL,
	"from_status" varchar(40),
	"to_status" varchar(40) NOT NULL,
	"changed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "status_events_entity_idx" ON "status_events" USING btree ("entity","entity_id","changed_at");--> statement-breakpoint
CREATE INDEX "status_events_org_idx" ON "status_events" USING btree ("organization_id","changed_at");--> statement-breakpoint
-- Rediseño 2026 (fase 0): cada cambio de estado de una factura o un caso queda
-- registrado por la base, sin depender de cada camino del código.
CREATE OR REPLACE FUNCTION docuia_log_status_event() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO status_events (organization_id, entity, entity_id, from_status, to_status)
    VALUES (NEW.organization_id, TG_ARGV[0], NEW.id::text, NULL, NEW.status::text);
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO status_events (organization_id, entity, entity_id, from_status, to_status)
    VALUES (NEW.organization_id, TG_ARGV[0], NEW.id::text, OLD.status::text, NEW.status::text);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS history_documents_status_event ON history_documents;--> statement-breakpoint
CREATE TRIGGER history_documents_status_event
  AFTER INSERT OR UPDATE OF status ON history_documents
  FOR EACH ROW EXECUTE FUNCTION docuia_log_status_event('document');--> statement-breakpoint
DROP TRIGGER IF EXISTS contract_cases_status_event ON contract_cases;--> statement-breakpoint
CREATE TRIGGER contract_cases_status_event
  AFTER INSERT OR UPDATE OF status ON contract_cases
  FOR EACH ROW EXECUTE FUNCTION docuia_log_status_event('contract_case');
