import {
  pgTable, varchar, text, boolean, integer, json,
  timestamp, bigserial, decimal, pgEnum, index,
} from "drizzle-orm/pg-core";

export const documentTypeEnum = pgEnum("document_type", [
  "invoice", "purchase_order", "xml_cfdi",
]);

export const documentStatusEnum = pgEnum("document_status", [
  "uploaded", "extracting", "review", "pending_approval",
  "approved", "processing", "completed", "failed",
]);

export const historyDocuments = pgTable("history_documents", {
  id:               bigserial("id", { mode: "number" }).primaryKey(),
  organizationId:   varchar("organization_id", { length: 36 }).notNull(),
  subsidiaryId:     varchar("subsidiary_id", { length: 36 }).notNull(),
  documentType:     documentTypeEnum("document_type").notNull(),
  status:           documentStatusEnum("status").notNull().default("uploaded"),
  vendor:           varchar("vendor", { length: 191 }),
  numDoc:           varchar("num_doc", { length: 191 }),
  total:            decimal("total", { precision: 14, scale: 2 }).default("0"),
  products:         json("products"),
  storageKey:       text("storage_key"),
  urlNetsuite:      text("url_netsuite"),
  netsuiteDocId:    varchar("netsuite_doc_id", { length: 191 }),
  extractionEngine: varchar("extraction_engine", { length: 120 }),
  fallbackUsed:     boolean("fallback_used").notNull().default(false),
  processedBy:      varchar("processed_by", { length: 36 }),
  approvedBy:       varchar("approved_by", { length: 36 }),
  errorMessage:     text("error_message"),
  createdAt:        timestamp("created_at").notNull().defaultNow(),
  updatedAt:        timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("history_docs_org_idx").on(t.organizationId, t.createdAt),
  index("history_docs_sub_idx").on(t.subsidiaryId),
  index("history_docs_vendor_idx").on(t.organizationId, t.vendor),
  index("history_docs_status_idx").on(t.organizationId, t.status),
  index("history_docs_num_doc_idx").on(t.organizationId, t.numDoc),
]);

// -- Exception queue ----------------------------------------------

export const exceptionStatusEnum = pgEnum("exception_status", [
  "pending", "in_progress", "resolved", "dismissed",
]);

export const failureStageEnum = pgEnum("failure_stage", [
  "extract", "validate", "process",
]);

export const exceptionQueue = pgTable("exception_queue", {
  id:                bigserial("id", { mode: "number" }).primaryKey(),
  organizationId:    varchar("organization_id", { length: 36 }).notNull(),
  subsidiaryId:      varchar("subsidiary_id", { length: 36 }),
  documentType:      varchar("document_type", { length: 60 }),
  originalFilename:  varchar("original_filename", { length: 500 }),
  storageKey:        text("storage_key"),
  extractionJson:    json("extraction_json"),
  failureStage:      failureStageEnum("failure_stage").notNull(),
  failureReason:     text("failure_reason"),
  errorCode:         varchar("error_code", { length: 80 }),
  status:            exceptionStatusEnum("status").notNull().default("pending"),
  assignedTo:        varchar("assigned_to", { length: 36 }),
  retryCount:        integer("retry_count").notNull().default(0),
  lastRetryAt:       timestamp("last_retry_at"),
  resolvedAt:        timestamp("resolved_at"),
  resolvedBy:        varchar("resolved_by", { length: 36 }),
  resolutionNotes:   text("resolution_notes"),
  createdAt:         timestamp("created_at").notNull().defaultNow(),
  updatedAt:         timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("exceptions_org_status_idx").on(t.organizationId, t.status, t.createdAt),
  index("exceptions_assigned_idx").on(t.assignedTo, t.status),
]);

// -- Workflow runtime logs ----------------------------------------

export const workflowLogStatusEnum = pgEnum("workflow_log_status", [
  "STARTED", "INFO", "SUCCESS", "FAILED",
]);

export const workflowRuntimeLogs = pgTable("workflow_runtime_logs", {
  id:            bigserial("id", { mode: "number" }).primaryKey(),
  organizationId: varchar("organization_id", { length: 36 }).notNull(),
  requestId:     varchar("request_id", { length: 80 }),
  stage:         varchar("stage", { length: 32 }),
  step:          varchar("step", { length: 64 }),
  status:        workflowLogStatusEnum("status"),
  model:         varchar("model", { length: 120 }),
  engine:        varchar("engine", { length: 120 }),
  documentType:  varchar("document_type", { length: 32 }),
  vendor:        varchar("vendor", { length: 255 }),
  invoiceNumber: varchar("invoice_number", { length: 120 }),
  lineCount:     integer("line_count"),
  durationMs:    integer("duration_ms"),
  httpStatus:    integer("http_status"),
  fallbackUsed:  boolean("fallback_used").notNull().default(false),
  metaJson:      json("meta_json"),
  errorMessage:  text("error_message"),
  createdAt:     timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("wf_logs_org_date_idx").on(t.organizationId, t.createdAt),
  index("wf_logs_request_idx").on(t.requestId),
  index("wf_logs_status_idx").on(t.status),
]);
