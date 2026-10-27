import {
  pgTable, varchar, text, integer, timestamp, bigserial, uniqueIndex, index,
} from "drizzle-orm/pg-core";

// A tenant's searchable document corpus. Case documents are indexed here too,
// so references can cross cases without copying the original object in MinIO.
export const contractArchiveDocuments = pgTable("contract_archive_documents", {
  id: varchar("id", { length: 36 }).primaryKey(),
  organizationId: varchar("organization_id", { length: 36 }).notNull(),
  caseDocumentId: varchar("case_document_id", { length: 36 }),
  storageKey: varchar("storage_key", { length: 500 }).notNull(),
  originalName: varchar("original_name", { length: 255 }).notNull(),
  mimeType: varchar("mime_type", { length: 100 }).notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  documentCode: varchar("document_code", { length: 160 }),
  normalizedCode: varchar("normalized_code", { length: 160 }),
  documentType: varchar("document_type", { length: 60 }),
  title: varchar("title", { length: 255 }),
  status: varchar("status", { length: 20 }).notNull().default("queued"),
  pageCount: integer("page_count"),
  indexedPages: integer("indexed_pages").notNull().default(0),
  errorMessage: text("error_message"),
  createdBy: varchar("created_by", { length: 36 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("contract_archive_storage_idx").on(t.organizationId, t.storageKey),
  index("contract_archive_code_idx").on(t.organizationId, t.normalizedCode),
  index("contract_archive_org_status_idx").on(t.organizationId, t.status, t.createdAt),
]);

export const contractArchivePages = pgTable("contract_archive_pages", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  organizationId: varchar("organization_id", { length: 36 }).notNull(),
  documentId: varchar("document_id", { length: 36 }).notNull(),
  pageNumber: integer("page_number").notNull(),
  text: text("text").notNull(),
  ocrMode: varchar("ocr_mode", { length: 12 }).notNull(),
}, (t) => [
  uniqueIndex("contract_archive_page_idx").on(t.documentId, t.pageNumber),
  index("contract_archive_pages_org_idx").on(t.organizationId, t.documentId),
]);

export const contractArchiveReferences = pgTable("contract_archive_references", {
  id: varchar("id", { length: 36 }).primaryKey(),
  organizationId: varchar("organization_id", { length: 36 }).notNull(),
  sourceDocumentId: varchar("source_document_id", { length: 36 }).notNull(),
  rawCode: varchar("raw_code", { length: 160 }).notNull(),
  normalizedCode: varchar("normalized_code", { length: 160 }).notNull(),
  pageNumber: integer("page_number").notNull(),
  context: text("context").notNull(),
  targetDocumentId: varchar("target_document_id", { length: 36 }),
  status: varchar("status", { length: 20 }).notNull().default("missing"),
  assessment: varchar("assessment", { length: 20 }),
  reason: text("reason"),
  reviewedBy: varchar("reviewed_by", { length: 36 }),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("contract_archive_ref_unique_idx").on(t.sourceDocumentId, t.normalizedCode),
  index("contract_archive_ref_code_idx").on(t.organizationId, t.normalizedCode),
  index("contract_archive_ref_status_idx").on(t.organizationId, t.status),
]);

// Uploads are user- and tenant-scoped. They become visible only after S3 has
// verified all parts and a case/archive record has claimed the completed file.
export const contractLargeUploads = pgTable("contract_large_uploads", {
  id: varchar("id", { length: 36 }).primaryKey(),
  organizationId: varchar("organization_id", { length: 36 }).notNull(),
  createdBy: varchar("created_by", { length: 36 }).notNull(),
  storageKey: varchar("storage_key", { length: 500 }).notNull(),
  originalName: varchar("original_name", { length: 255 }).notNull(),
  mimeType: varchar("mime_type", { length: 100 }).notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  multipartId: varchar("multipart_id", { length: 500 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("uploading"),
  claimedBy: varchar("claimed_by", { length: 60 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
}, (t) => [
  uniqueIndex("contract_large_upload_storage_idx").on(t.storageKey),
  index("contract_large_upload_org_idx").on(t.organizationId, t.createdBy, t.status),
]);
