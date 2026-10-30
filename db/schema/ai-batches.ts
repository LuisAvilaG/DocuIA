import { pgTable, bigserial, varchar, integer, json, text, timestamp, index } from "drizzle-orm/pg-core";

// Bulk uploads processed through a provider's batch API (half price, results
// within hours). An item is a queued document waiting for, or answered by, a
// batch; the pipeline then runs on the stored answer instead of calling the
// model again.

export const aiBatches = pgTable("ai_batches", {
  id:             varchar("id", { length: 80 }).primaryKey(),          // provider batch id
  organizationId: varchar("organization_id", { length: 36 }).notNull(),
  provider:       varchar("provider", { length: 20 }).notNull(),
  model:          varchar("model", { length: 60 }).notNull(),
  status:         varchar("status", { length: 20 }).notNull().default("submitted"), // submitted | ended | failed
  itemCount:      integer("item_count").notNull().default(0),
  countsJson:     json("counts_json"),
  createdAt:      timestamp("created_at").notNull().defaultNow(),
  endedAt:        timestamp("ended_at"),
}, (t) => [
  index("ai_batches_org_idx").on(t.organizationId, t.status),
]);

export const aiBatchItems = pgTable("ai_batch_items", {
  id:             bigserial("id", { mode: "number" }).primaryKey(),
  organizationId: varchar("organization_id", { length: 36 }).notNull(),
  documentId:     integer("document_id").notNull(),
  batchId:        varchar("batch_id", { length: 80 }),
  status:         varchar("status", { length: 20 }).notNull().default("pending"), // pending | submitted | done | failed | bypassed
  jobJson:        json("job_json").notNull(),      // the pipeline job to run once the answer is in
  resultJson:     json("result_json"),             // { rawJson, model, promptTokens, completionTokens, cachedTokens }
  error:          text("error"),
  createdAt:      timestamp("created_at").notNull().defaultNow(),
  updatedAt:      timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("ai_batch_items_org_status_idx").on(t.organizationId, t.status),
  index("ai_batch_items_batch_idx").on(t.batchId),
]);
