import { pgTable, bigserial, varchar, timestamp, index } from "drizzle-orm/pg-core";

// Cada cambio de estado de una factura (history_documents) o de un caso de
// contratos (contract_cases). Lo llenan triggers de la base (migración
// 0018_status_events), así ningún camino del código se queda sin registrar.
// Sirve para medir tiempos por etapa, antigüedad de pendientes y respuesta
// de aprobadores (fase 6 del rediseño).
export const statusEvents = pgTable("status_events", {
  id:             bigserial("id", { mode: "number" }).primaryKey(),
  organizationId: varchar("organization_id", { length: 36 }).notNull(),
  entity:         varchar("entity", { length: 20 }).notNull(),      // "document" | "contract_case"
  entityId:       varchar("entity_id", { length: 36 }).notNull(),
  fromStatus:     varchar("from_status", { length: 40 }),           // null al crearse
  toStatus:       varchar("to_status", { length: 40 }).notNull(),
  changedAt:      timestamp("changed_at").notNull().defaultNow(),
}, (t) => [
  index("status_events_entity_idx").on(t.entity, t.entityId, t.changedAt),
  index("status_events_org_idx").on(t.organizationId, t.changedAt),
]);
