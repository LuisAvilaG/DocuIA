DROP TABLE "contract_obligations" CASCADE;--> statement-breakpoint
-- La feature se retiró: las fechas se revisan con el control «Fecha y vigencia» del flujo.
DELETE FROM "org_features" WHERE "feature_id" = 'contract_obligation_tracking';
--> statement-breakpoint
DELETE FROM "features" WHERE "id" = 'contract_obligation_tracking';
