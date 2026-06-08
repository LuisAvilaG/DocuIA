import {
  pgTable, varchar, text, boolean, integer, json,
  timestamp, bigserial, numeric, pgEnum, uniqueIndex, index,
} from "drizzle-orm/pg-core";

// ── Enums ────────────────────────────────────────────────────────────

export const expenseReportStatusEnum = pgEnum("expense_report_status", [
  "draft",
  "submitted",
  "under_review",
  "approved",
  "rejected",
  "syncing",
  "synced",
  "exception",
]);

export const expensePaymentMethodEnum = pgEnum("expense_payment_method", [
  "personal",
  "company_pays_vendor",
]);

export const expenseDocumentTypeEnum = pgEnum("expense_document_type", [
  "invoice",
  "receipt",
  "cuenta_cobro",
  "documento_equivalente",
  "unknown",
]);

export const expenseNsRecordTypeEnum = pgEnum("expense_ns_record_type", [
  "expense_report",
  "vendor_bill",
]);

// ── Expense Categories (synced from NetSuite expensecategory) ─────────

export const expenseCategories = pgTable("expense_categories", {
  id:                   bigserial("id", { mode: "number" }).primaryKey(),
  organizationId:       varchar("organization_id", { length: 36 }).notNull(),
  subsidiaryId:         varchar("subsidiary_id", { length: 36 }),
  netsuiteCategoryId:   varchar("netsuite_category_id", { length: 64 }).notNull(),
  netsuiteAccountId:    varchar("netsuite_account_id", { length: 64 }),
  netsuiteAccountName:  varchar("netsuite_account_name", { length: 255 }),
  netsuiteTaxCode:      varchar("netsuite_tax_code", { length: 64 }),
  name:                 varchar("name", { length: 255 }).notNull(),
  dailyCap:             numeric("daily_cap", { precision: 12, scale: 2 }),
  monthlyCap:           numeric("monthly_cap", { precision: 12, scale: 2 }),
  requiredDocTypes:     json("required_doc_types").$type<string[]>().default([]),
  isActive:             boolean("is_active").notNull().default(true),
  syncedAt:             timestamp("synced_at"),
  updatedAt:            timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("expense_categories_org_ns_idx").on(t.organizationId, t.netsuiteCategoryId),
  index("expense_categories_org_idx").on(t.organizationId),
]);

// ── Catalog Departments (synced from NetSuite) ────────────────────────

export const catalogDepartments = pgTable("catalog_departments", {
  id:             bigserial("id", { mode: "number" }).primaryKey(),
  organizationId: varchar("organization_id", { length: 36 }).notNull(),
  subsidiaryId:   varchar("subsidiary_id", { length: 36 }),
  netsuiteId:     varchar("netsuite_id", { length: 64 }).notNull(),
  name:           varchar("name", { length: 255 }).notNull(),
  isInactive:     boolean("is_inactive").notNull().default(false),
  updatedAt:      timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("catalog_departments_org_ns_idx").on(t.organizationId, t.netsuiteId),
  index("catalog_departments_org_idx").on(t.organizationId),
]);

// ── Catalog Classes / UT (synced from NetSuite) ───────────────────────

export const catalogClasses = pgTable("catalog_classes", {
  id:             bigserial("id", { mode: "number" }).primaryKey(),
  organizationId: varchar("organization_id", { length: 36 }).notNull(),
  subsidiaryId:   varchar("subsidiary_id", { length: 36 }),
  netsuiteId:     varchar("netsuite_id", { length: 64 }).notNull(),
  name:           varchar("name", { length: 255 }).notNull(),
  isInactive:     boolean("is_inactive").notNull().default(false),
  updatedAt:      timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("catalog_classes_org_ns_idx").on(t.organizationId, t.netsuiteId),
  index("catalog_classes_org_idx").on(t.organizationId),
]);

// ── Tax Rules Engine ──────────────────────────────────────────────────

export const expenseTaxRules = pgTable("expense_tax_rules", {
  id:             bigserial("id", { mode: "number" }).primaryKey(),
  organizationId: varchar("organization_id", { length: 36 }),
  countryCode:    varchar("country_code", { length: 5 }).notNull(),
  name:           varchar("name", { length: 150 }).notNull(),
  triggerJson:    json("trigger_json").notNull(),
  taxesJson:      json("taxes_json").notNull(),
  priority:       integer("priority").notNull().default(0),
  isActive:       boolean("is_active").notNull().default(true),
  createdAt:      timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("expense_tax_rules_org_country_idx").on(t.organizationId, t.countryCode),
  index("expense_tax_rules_country_idx").on(t.countryCode),
]);

// ── Approval Chains ───────────────────────────────────────────────────

export const expenseApprovalChains = pgTable("expense_approval_chains", {
  id:             varchar("id", { length: 36 }).primaryKey(),
  organizationId: varchar("organization_id", { length: 36 }).notNull(),
  name:           varchar("name", { length: 150 }).notNull().default("Default"),
  stepsJson:      json("steps_json").notNull().$type<Array<{
    role: "manager" | "admin";
    condition: "always" | string;
    order: number;
  }>>(),
  isActive:       boolean("is_active").notNull().default(true),
  createdAt:      timestamp("created_at").notNull().defaultNow(),
  updatedAt:      timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("expense_approval_chains_org_idx").on(t.organizationId),
]);

// ── Expense Reports (cabecera) ────────────────────────────────────────

export const expenseReports = pgTable("expense_reports", {
  id:                      varchar("id", { length: 36 }).primaryKey(),
  organizationId:          varchar("organization_id", { length: 36 }).notNull(),
  submitterId:             varchar("submitter_id", { length: 36 }).notNull(),
  purpose:                 varchar("purpose", { length: 500 }).notNull(),
  periodStart:             timestamp("period_start"),
  periodEnd:               timestamp("period_end"),
  status:                  expenseReportStatusEnum("status").notNull().default("draft"),
  rejectedReason:          text("rejected_reason"),
  submittedAt:             timestamp("submitted_at"),
  approvedAt:              timestamp("approved_at"),
  approvedBy:              varchar("approved_by", { length: 36 }),
  netsuiteExpenseReportId: varchar("netsuite_expense_report_id", { length: 64 }),
  syncError:               text("sync_error"),
  createdAt:               timestamp("created_at").notNull().defaultNow(),
  updatedAt:               timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("expense_reports_org_idx").on(t.organizationId),
  index("expense_reports_submitter_idx").on(t.submitterId),
  index("expense_reports_status_idx").on(t.status),
]);

// ── Expense Items (líneas) ────────────────────────────────────────────

export const expenseItems = pgTable("expense_items", {
  id:                       varchar("id", { length: 36 }).primaryKey(),
  reportId:                 varchar("report_id", { length: 36 }).notNull(),
  lineNumber:               integer("line_number").notNull().default(1),
  categoryId:               integer("category_id"),
  departmentId:             integer("department_id"),
  classId:                  integer("class_id"),
  expenseDate:              timestamp("expense_date"),
  description:              text("description"),
  // Vendor info (extracted by OCR, resolved before NS sync)
  vendorName:               varchar("vendor_name", { length: 500 }),
  vendorNit:                varchar("vendor_nit", { length: 50 }),
  vendorNsInternalId:       varchar("vendor_ns_internal_id", { length: 64 }),
  // Financial fields
  invoiceNumber:            varchar("invoice_number", { length: 100 }),
  invoiceDate:              timestamp("invoice_date"),
  subtotal:                 numeric("subtotal", { precision: 14, scale: 2 }),
  taxAmount:                numeric("tax_amount", { precision: 14, scale: 2 }).default("0"),
  retentionAmount:          numeric("retention_amount", { precision: 14, scale: 2 }).default("0"),
  total:                    numeric("total", { precision: 14, scale: 2 }),
  currency:                 varchar("currency", { length: 10 }).notNull().default("COP"),
  // Classification
  paymentMethod:            expensePaymentMethodEnum("payment_method").notNull().default("personal"),
  documentTypeDetected:     expenseDocumentTypeEnum("document_type_detected").default("unknown"),
  needsDocumentoEquivalente: boolean("needs_documento_equivalente").notNull().default(false),
  // NetSuite sync
  nsRecordType:             expenseNsRecordTypeEnum("ns_record_type"),
  nsRecordId:               varchar("ns_record_id", { length: 64 }),
  syncError:                text("sync_error"),
  createdAt:                timestamp("created_at").notNull().defaultNow(),
  updatedAt:                timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("expense_items_report_idx").on(t.reportId),
  index("expense_items_vendor_nit_idx").on(t.vendorNit),
  index("expense_items_invoice_idx").on(t.reportId, t.invoiceNumber),
]);

// ── Expense Documents (archivos adjuntos) ─────────────────────────────

export const expenseDocuments = pgTable("expense_documents", {
  id:                   bigserial("id", { mode: "number" }).primaryKey(),
  itemId:               varchar("item_id", { length: 36 }).notNull(),
  fileKey:              varchar("file_key", { length: 500 }),
  mimeType:             varchar("mime_type", { length: 100 }),
  originalName:         varchar("original_name", { length: 255 }),
  ocrRaw:               json("ocr_raw"),
  ocrConfidence:        numeric("ocr_confidence", { precision: 4, scale: 3 }),
  documentTypeDetected: expenseDocumentTypeEnum("document_type_detected").default("unknown"),
  createdAt:            timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("expense_documents_item_idx").on(t.itemId),
]);
