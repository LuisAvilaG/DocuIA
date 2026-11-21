// Bulk uploads through the provider's batch API. Documents wait as batch
// items, get grouped per organization into one provider batch, and once the
// batch ends each document goes through the normal pipeline with the model's
// answer already in hand (half the token price, no second call).

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiBatches, aiBatchItems } from "@/db/schema";
import { getFileBuffer } from "@/lib/storage/minio";
import { getFeature } from "@/lib/features";
import type { PipelineJob } from "@/lib/queue";
import { extractionRequest, DEFAULT_PRIMARY_MODEL, configuredModel, configuredEffort } from "@/lib/workflow/extract";
import { batchResults, cancelBatch, claudeReadsFile, createBatch, getBatch, providerOf, type AiJsonRequest } from "./provider";
import { recordAiUsage } from "./usage";

const MAX_ITEMS_PER_BATCH = 500;
// Files of one batch, before base64 (which adds a third): well under what the
// provider accepts per request and what the server can hold in memory.
const MAX_BATCH_BYTES = 120 * 1024 * 1024;

export interface BatchMode { model: string; waitMinutes: number }

/** Whether this organization's bulk uploads should go through a batch, and with which model. */
export async function batchModeFor(organizationId: string, documentType: string): Promise<BatchMode | null> {
  if (documentType === "xml_cfdi") return null; // parsed without a model
  const [bulk, models, forceSecondary] = await Promise.all([
    getFeature(organizationId, "bulk_upload"), getFeature(organizationId, "ai_model_selection"),
    getFeature(organizationId, "ai_force_secondary").catch(() => null),
  ]);
  if (!bulk.isEnabled || bulk.config.batch_mode !== true) return null;
  // A batch runs the first model. With "always the precise model" on, the
  // documents go one by one through the normal queue, which uses the second.
  if (forceSecondary?.isEnabled) return null;
  const model = configuredModel(models.isEnabled ? models.config.primary_model : undefined, DEFAULT_PRIMARY_MODEL);
  if (providerOf(model) !== "anthropic") return null;
  const wait = Number(bulk.config.batch_wait_minutes);
  return { model, waitMinutes: Number.isFinite(wait) ? Math.min(60, Math.max(1, Math.round(wait))) : 2 };
}

export async function queueDocumentForBatch(job: PipelineJob): Promise<void> {
  await db.insert(aiBatchItems).values({ organizationId: job.organizationId, documentId: job.documentId, status: "pending", jobJson: job });
}

/**
 * Takes a document back out of the batch wait (it will run through the regular
 * queue instead), so a later collection cannot process it a second time.
 */
export async function withdrawDocumentFromBatch(documentId: number): Promise<void> {
  await db.update(aiBatchItems).set({ status: "bypassed", error: "se procesó por la cola normal", updatedAt: new Date() })
    .where(and(eq(aiBatchItems.documentId, documentId), eq(aiBatchItems.status, "pending")));
}

/** Groups every pending item of the organization into one provider batch. Returns the batch id, or null when there was nothing to send. */
export async function collectBatch(organizationId: string, enqueue: (job: PipelineJob) => Promise<unknown>): Promise<string | null> {
  const pending = await db.query.aiBatchItems.findMany({
    where: and(eq(aiBatchItems.organizationId, organizationId), eq(aiBatchItems.status, "pending")),
    orderBy: [aiBatchItems.id], limit: MAX_ITEMS_PER_BATCH,
  });
  if (pending.length === 0) return null;
  const mode = await batchModeFor(organizationId, "invoice");
  if (!mode) {
    // Batch mode was switched off (or moved to a non-batch provider) while
    // documents were waiting: run them the normal way.
    for (const item of pending) await enqueue(item.jobJson as PipelineJob);
    await db.update(aiBatchItems).set({ status: "bypassed", updatedAt: new Date() }).where(inArray(aiBatchItems.id, pending.map((i) => i.id)));
    return null;
  }
  const models = await getFeature(organizationId, "ai_model_selection");
  const maxChars = Number(models.config.max_chars) || undefined;
  const effort = configuredEffort(models.config.reasoning_effort);

  const requests: Array<{ customId: string; request: AiJsonRequest }> = [];
  const jobs = new Map<string, PipelineJob>();
  const failed: number[] = [];
  let bytes = 0;
  for (const item of pending) {
    const job = item.jobJson as PipelineJob;
    // Enough for this batch: the rest stay pending for the next one (the
    // collector runs again until nothing is left).
    if (bytes >= MAX_BATCH_BYTES) break;
    try {
      // One file the provider cannot read would reject the whole batch.
      if (!claudeReadsFile(job.mimeType)) throw new Error(`formato ${job.mimeType} no admitido en lotes`);
      const buffer = await getFileBuffer(job.storageKey);
      if (requests.length > 0 && bytes + buffer.length > MAX_BATCH_BYTES) break;
      bytes += buffer.length;
      jobs.set(String(item.id), job);
      requests.push({ customId: String(item.id), request: extractionRequest(mode.model, job.fileName, job.mimeType, buffer.toString("base64"), { maxChars, effort }) });
    } catch (error) {
      failed.push(item.id);
      console.error("[ai-batch] el archivo no entra al lote, se procesa en línea", job.storageKey, error instanceof Error ? error.message : error);
      await enqueue(job);
    }
  }
  if (failed.length) await db.update(aiBatchItems).set({ status: "bypassed", error: "archivo no disponible o no admitido al armar el lote", updatedAt: new Date() }).where(inArray(aiBatchItems.id, failed));
  if (requests.length === 0) return null;

  let batchId: string;
  try {
    batchId = await createBatch(requests);
  } catch (error) {
    // The provider did not take the batch. Left pending, the documents sat in
    // "Leyendo" for a day: they go through the regular queue instead.
    console.error("[ai-batch] no se pudo crear el lote, los documentos se procesan en línea", error instanceof Error ? error.message : error);
    for (const job of jobs.values()) await enqueue(job);
    await db.update(aiBatchItems).set({ status: "bypassed", error: "el proveedor no aceptó el lote", updatedAt: new Date() }).where(inArray(aiBatchItems.id, requests.map((r) => Number(r.customId))));
    return null;
  }
  // The provider already has the batch: if the database cannot record it, the
  // retry of this job would send the same documents in a second batch and the
  // first would run with nobody reading it. So: insist, and if it still fails
  // cancel the batch before giving the job back to its retry.
  const record = async () => {
    await db.transaction(async (tx) => {
      await tx.insert(aiBatches).values({ id: batchId, organizationId, provider: "anthropic", model: mode.model, status: "submitted", itemCount: requests.length }).onConflictDoNothing();
      await tx.update(aiBatchItems).set({ status: "submitted", batchId, updatedAt: new Date() }).where(inArray(aiBatchItems.id, requests.map((r) => Number(r.customId))));
    });
  };
  for (let attempt = 0; ; attempt++) {
    try { await record(); break; } catch (error) {
      if (attempt < 2) { await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1))); continue; }
      await cancelBatch(batchId).catch((cause) => console.error("[ai-batch] el lote quedó sin registrar y no se pudo cancelar", batchId, cause instanceof Error ? cause.message : cause));
      throw error;
    }
  }
  return batchId;
}

/** Checks one batch; when it has ended, hands every document to the pipeline. */
export async function pollBatch(batchId: string, enqueue: (job: PipelineJob) => Promise<unknown>): Promise<"pending" | "ended" | "missing"> {
  const batch = await db.query.aiBatches.findFirst({ where: eq(aiBatches.id, batchId) });
  if (!batch) return "missing";
  if (batch.status !== "submitted") return "ended";
  const status = await getBatch(batchId);
  if (!status.ended) return "pending";

  const items = await db.query.aiBatchItems.findMany({ where: eq(aiBatchItems.batchId, batchId) });
  const byId = new Map(items.map((item) => [String(item.id), item]));
  // Rebuild the requests without the file: the result reader only needs model and shape.
  const requests = new Map(items.map((item) => [String(item.id), { model: batch.model, instruction: "", parts: [] } as AiJsonRequest]));
  const results = await batchResults(batchId, requests);
  const seen = new Set<string>();
  for (const result of results) {
    const item = byId.get(result.customId);
    if (!item) continue;
    seen.add(result.customId);
    const job = item.jobJson as PipelineJob;
    // Each item is taken once (submitted → done / failed) before its document is
    // handed over. When this job is retried halfway (an enqueue failed, a deploy)
    // the ones already delivered are skipped: they used to be queued again and
    // their AI usage counted twice.
    const take = (set: Partial<typeof aiBatchItems.$inferInsert>) => db.update(aiBatchItems).set({ ...set, updatedAt: new Date() })
      .where(and(eq(aiBatchItems.id, item.id), eq(aiBatchItems.status, "submitted"))).returning({ id: aiBatchItems.id });
    const giveBack = () => db.update(aiBatchItems).set({ status: "submitted", updatedAt: new Date() }).where(eq(aiBatchItems.id, item.id));
    if (result.ok) {
      const r = result.result;
      const precomputed = { rawJson: r.rawText, model: r.model, promptTokens: r.usage.inputTokens, completionTokens: r.usage.outputTokens, cachedTokens: r.usage.cachedInputTokens };
      if (!(await take({ status: "done", resultJson: precomputed })).length) continue;
      try { await enqueue({ ...job, precomputedExtraction: precomputed }); } catch (error) { await giveBack(); throw error; }
      recordAiUsage({ model: r.model, ...r.usage, batch: true, orgId: item.organizationId, source: "facturas" });
    } else {
      // The batch could not answer for this one: the pipeline calls the model itself.
      if (!(await take({ status: "failed", error: result.error })).length) continue;
      try { await enqueue(job); } catch (error) { await giveBack(); throw error; }
    }
  }
  for (const item of items) {
    if (seen.has(String(item.id)) || item.status !== "submitted") continue;
    await db.update(aiBatchItems).set({ status: "failed", error: "sin resultado en el lote", updatedAt: new Date() }).where(eq(aiBatchItems.id, item.id));
    await enqueue(item.jobJson as PipelineJob);
  }
  await db.update(aiBatches).set({ status: "ended", countsJson: status.counts, endedAt: new Date() }).where(eq(aiBatches.id, batchId));
  return "ended";
}
