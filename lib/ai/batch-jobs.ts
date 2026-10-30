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
import { batchResults, createBatch, getBatch, providerOf, type AiJsonRequest } from "./provider";

const MAX_ITEMS_PER_BATCH = 500;

export interface BatchMode { model: string; waitMinutes: number }

/** Whether this organization's bulk uploads should go through a batch, and with which model. */
export async function batchModeFor(organizationId: string, documentType: string): Promise<BatchMode | null> {
  if (documentType === "xml_cfdi") return null; // parsed without a model
  const [bulk, models] = await Promise.all([getFeature(organizationId, "bulk_upload"), getFeature(organizationId, "ai_model_selection")]);
  if (!bulk.isEnabled || bulk.config.batch_mode !== true) return null;
  const model = configuredModel(models.isEnabled ? models.config.primary_model : undefined, DEFAULT_PRIMARY_MODEL);
  if (providerOf(model) !== "anthropic") return null;
  const wait = Number(bulk.config.batch_wait_minutes);
  return { model, waitMinutes: Number.isFinite(wait) ? Math.min(60, Math.max(1, Math.round(wait))) : 2 };
}

export async function queueDocumentForBatch(job: PipelineJob): Promise<void> {
  await db.insert(aiBatchItems).values({ organizationId: job.organizationId, documentId: job.documentId, status: "pending", jobJson: job });
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
  const failed: number[] = [];
  for (const item of pending) {
    const job = item.jobJson as PipelineJob;
    try {
      const buffer = await getFileBuffer(job.storageKey);
      requests.push({ customId: String(item.id), request: extractionRequest(mode.model, job.fileName, job.mimeType, buffer.toString("base64"), { maxChars, effort }) });
    } catch (error) {
      failed.push(item.id);
      console.error("[ai-batch] no se pudo leer el archivo, se procesa en línea", job.storageKey, error instanceof Error ? error.message : error);
      await enqueue(job);
    }
  }
  if (failed.length) await db.update(aiBatchItems).set({ status: "bypassed", error: "archivo no disponible al armar el lote", updatedAt: new Date() }).where(inArray(aiBatchItems.id, failed));
  if (requests.length === 0) return null;

  const batchId = await createBatch(requests);
  await db.insert(aiBatches).values({ id: batchId, organizationId, provider: "anthropic", model: mode.model, status: "submitted", itemCount: requests.length });
  await db.update(aiBatchItems).set({ status: "submitted", batchId, updatedAt: new Date() }).where(inArray(aiBatchItems.id, requests.map((r) => Number(r.customId))));
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
    if (result.ok) {
      const r = result.result;
      const precomputed = { rawJson: r.rawText, model: r.model, promptTokens: r.usage.inputTokens, completionTokens: r.usage.outputTokens, cachedTokens: r.usage.cachedInputTokens };
      await db.update(aiBatchItems).set({ status: "done", resultJson: precomputed, updatedAt: new Date() }).where(eq(aiBatchItems.id, item.id));
      await enqueue({ ...job, precomputedExtraction: precomputed });
    } else {
      // The batch could not answer for this one: the pipeline calls the model itself.
      await db.update(aiBatchItems).set({ status: "failed", error: result.error, updatedAt: new Date() }).where(eq(aiBatchItems.id, item.id));
      await enqueue(job);
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
