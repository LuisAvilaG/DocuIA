import {
  pgTable, varchar, text, boolean, integer, json,
  bigserial, timestamp, pgEnum, uniqueIndex, index,
} from "drizzle-orm/pg-core";

// ── Enums ─────────────────────────────────────────────────────────────
export const contractCaseStatusEnum = pgEnum("contract_case_status", [
  "uploaded", "processing", "review", "validated", "generated", "failed",
  "approved", "rejected",
]);

// How a document's text was obtained.
export const contractOcrModeEnum = pgEnum("contract_ocr_mode", [
  "digital", "scanned", "mixed",
]);

// ── Configuration (per-org playbook) ──────────────────────────────────
// Document types the engine classifies into (configurable per org).
export const contractDocTypes = pgTable("contract_doc_types", {
  id:                 bigserial("id", { mode: "number" }).primaryKey(),
  organizationId:     varchar("organization_id", { length: 36 }).notNull(),
  key:                varchar("key", { length: 60 }).notNull(),
  name:               varchar("name", { length: 150 }).notNull(),
  classificationHint: text("classification_hint"), // guidance for the classifier
  sortOrder:          integer("sort_order").notNull().default(0),
  isActive:           boolean("is_active").notNull().default(true),
  createdAt:          timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("contract_doc_types_org_key_idx").on(t.organizationId, t.key),
  index("contract_doc_types_org_idx").on(t.organizationId),
]);

// Fields to extract per document type (the no-code schema builder).
export const contractFieldSchemas = pgTable("contract_field_schemas", {
  id:             bigserial("id", { mode: "number" }).primaryKey(),
  organizationId: varchar("organization_id", { length: 36 }).notNull(),
  docTypeKey:     varchar("doc_type_key", { length: 60 }).notNull(),
  fieldKey:       varchar("field_key", { length: 80 }).notNull(),
  label:          varchar("label", { length: 150 }).notNull(),
  fieldType:      varchar("field_type", { length: 30 }).notNull().default("string"), // string|number|date|list
  isList:         boolean("is_list").notNull().default(false),
  sortOrder:      integer("sort_order").notNull().default(0),
}, (t) => [
  uniqueIndex("contract_field_org_type_field_idx").on(t.organizationId, t.docTypeKey, t.fieldKey),
  index("contract_field_org_idx").on(t.organizationId),
]);

// Declarative cross-document validation rules (e.g. signer validation).
export const contractValidationRules = pgTable("contract_validation_rules", {
  id:             bigserial("id", { mode: "number" }).primaryKey(),
  organizationId: varchar("organization_id", { length: 36 }).notNull(),
  name:           varchar("name", { length: 150 }).notNull(),
  appliesTo:      varchar("applies_to", { length: 60 }).notNull(), // subject type, e.g. "signer"
  conditionsJson: json("conditions_json").notNull(),               // rule definition
  sortOrder:      integer("sort_order").notNull().default(0),
  isActive:       boolean("is_active").notNull().default(true),
}, (t) => [
  index("contract_rules_org_idx").on(t.organizationId),
]);

// Output document templates (e.g. insurance quote) with letterhead + field mapping.
export const contractOutputTemplates = pgTable("contract_output_templates", {
  id:              bigserial("id", { mode: "number" }).primaryKey(),
  organizationId:  varchar("organization_id", { length: 36 }).notNull(),
  key:             varchar("key", { length: 60 }).notNull(),
  name:            varchar("name", { length: 150 }).notNull(),
  body:            text("body").notNull(),               // template (HTML/handlebars-like)
  letterheadAsset: varchar("letterhead_asset", { length: 255 }),
  mappingJson:     json("mapping_json"),                 // data → placeholders
  isActive:        boolean("is_active").notNull().default(true),
}, (t) => [
  uniqueIndex("contract_tmpl_org_key_idx").on(t.organizationId, t.key),
  index("contract_tmpl_org_idx").on(t.organizationId),
]);

// Visual flow definition (node graph) the user designs in the canvas builder.
// When an org has an active flow, it is the source of truth for the pipeline:
// intake/extract/validate/generate nodes compile into doc types, field schemas,
// validation rules and the output template. Backward-compatible: with no active
// flow the engine falls back to the per-table config above.
export const contractFlows = pgTable("contract_flows", {
  id:             varchar("id", { length: 36 }).primaryKey(),
  organizationId: varchar("organization_id", { length: 36 }).notNull(),
  name:           varchar("name", { length: 150 }).notNull(),
  graphJson:      json("graph_json").notNull(), // { nodes: FlowNode[], edges: FlowEdge[] }
  isActive:       boolean("is_active").notNull().default(true),
  version:        integer("version").notNull().default(1),
  createdAt:      timestamp("created_at").notNull().defaultNow(),
  updatedAt:      timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("contract_flows_org_idx").on(t.organizationId),
]);

// ── Runtime (a case + its documents + results) ────────────────────────
export const contractCases = pgTable("contract_cases", {
  id:             varchar("id", { length: 36 }).primaryKey(),
  organizationId: varchar("organization_id", { length: 36 }).notNull(),
  flowId:         varchar("flow_id", { length: 36 }), // which flow the client chose (null → fallback)
  title:          varchar("title", { length: 255 }),
  status:         contractCaseStatusEnum("status").notNull().default("uploaded"),
  createdBy:      varchar("created_by", { length: 36 }),
  resultJson:     json("result_json"),   // summary of extraction + validation
  errorMessage:   text("error_message"),
  createdAt:      timestamp("created_at").notNull().defaultNow(),
  updatedAt:      timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("contract_cases_org_idx").on(t.organizationId, t.createdAt),
  index("contract_cases_status_idx").on(t.organizationId, t.status),
]);

export const contractDocuments = pgTable("contract_documents", {
  id:            varchar("id", { length: 36 }).primaryKey(),
  caseId:        varchar("case_id", { length: 36 }).notNull(),
  storageKey:    varchar("storage_key", { length: 500 }).notNull(),
  originalName:  varchar("original_name", { length: 255 }),
  mimeType:      varchar("mime_type", { length: 100 }),
  detectedType:  varchar("detected_type", { length: 60 }),  // classified doc type key
  ocrMode:       contractOcrModeEnum("ocr_mode"),
  detectedText:  text("detected_text"),                     // transcribed text (for scans)
  extractedJson: json("extracted_json"),                    // { field: value }
  citationsJson: json("citations_json"),                    // { field: citation | citation[] }
  createdAt:     timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("contract_documents_case_idx").on(t.caseId),
]);

export const contractValidations = pgTable("contract_validations", {
  id:          bigserial("id", { mode: "number" }).primaryKey(),
  caseId:      varchar("case_id", { length: 36 }).notNull(),
  ruleName:    varchar("rule_name", { length: 150 }),          // the rule's label
  severity:    varchar("severity", { length: 10 }),            // info | warn | block
  subject:     varchar("subject", { length: 255 }).notNull(), // e.g. signer name
  status:      varchar("status", { length: 40 }).notNull(),   // rule-defined outcome label
  ok:          boolean("ok"),                                 // true=pass, false=fail, null=unknown
  reason:      text("reason"),
  checksJson:  json("checks_json"),
  citation:    text("citation"),
}, (t) => [
  index("contract_validations_case_idx").on(t.caseId),
]);

export const contractObligations = pgTable("contract_obligations", {
  id:          bigserial("id", { mode: "number" }).primaryKey(),
  caseId:      varchar("case_id", { length: 36 }).notNull(),
  type:        varchar("type", { length: 60 }),
  description: text("description"),
  dueDate:     timestamp("due_date"),
  alertAt:     timestamp("alert_at"),
  status:      varchar("status", { length: 30 }).notNull().default("open"),
}, (t) => [
  index("contract_obligations_case_idx").on(t.caseId),
  index("contract_obligations_alert_idx").on(t.alertAt),
]);
