import { PgBoss } from "pg-boss";
import { runPipeline } from "@/lib/workflow/pipeline";
import { getFileBuffer } from "@/lib/storage/minio";
import { processContractCase } from "@/lib/contracts/pipeline";
import { indexArchiveDocument } from "@/lib/contracts/archive";
import { collectBatch, pollBatch } from "@/lib/ai/batch-jobs";

export const PIPELINE_QUEUE = "document-pipeline";
export const CONTRACT_QUEUE = "contract-pipeline";
export const ARCHIVE_QUEUE = "contract-archive";
export const AI_BATCH_QUEUE = "ai-batch";

// Batch polling: every 5 minutes for up to 24 hours (the provider's own limit).
const BATCH_POLL_SECONDS = 300;
const BATCH_POLL_MAX_ATTEMPTS = 288;

type AiBatchJob =
  | { kind: "collect"; organizationId: string }
  | { kind: "poll"; batchId: string; attempt: number };

// Serializable job payload — NO Buffer (the file lives in MinIO, keyed by storageKey).
export type PipelineJob = {
  documentId:            number;
  organizationId:        string;
  subsidiaryId:          string;
  documentType:          "invoice" | "purchase_order" | "xml_cfdi";
  fileName:              string;
  mimeType:              string;
  storageKey:            string;
  requestedBy?:          string;
  autoProcessThreshold?: number;
  attachmentKey?:        string;
  // Batch path: the model's answer is already stored; the pipeline skips the call.
  precomputedExtraction?: { rawJson: string; model: string; promptTokens: number; completionTokens: number; cachedTokens?: number };
};

// ── Singleton boot ────────────────────────────────────────────────────
let boss: PgBoss | null = null;
let booting: Promise<PgBoss> | null = null;

export async function getBoss(): Promise<PgBoss> {
  if (boss) return boss;
  if (booting) return booting;
  booting = (async () => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is required for the job queue");
    const b = new PgBoss(url);
    b.on("error", (err) => console.error("[pg-boss]", err));
    await b.start();
    await b.createQueue(PIPELINE_QUEUE);  // idempotent
    await b.createQueue(CONTRACT_QUEUE);  // idempotent
    await b.createQueue(ARCHIVE_QUEUE);
    await b.createQueue(AI_BATCH_QUEUE);
    boss = b;
    return b;
  })();
  // A failed boot (e.g. a DB blip at startup) must not be cached forever,
  // or every later upload silently falls back to inline processing.
  booting.catch(() => { booting = null; });
  return booting;
}

export async function enqueueContractCase(caseId: string): Promise<string | null> {
  const b = await getBoss();
  return b.send(CONTRACT_QUEUE, { caseId }, { retryLimit: 2, retryDelay: 30, retryBackoff: true, expireInSeconds: 2 * 60 * 60 });
}

export async function enqueueArchiveDocument(documentId: string): Promise<string | null> {
  const b = await getBoss();
  return b.send(ARCHIVE_QUEUE, { documentId }, { retryLimit: 2, retryDelay: 30, retryBackoff: true, expireInSeconds: 2 * 60 * 60 });
}

/**
 * One collection run per organization, debounced: the first bulk upload
 * schedules it and later uploads within the window join the same batch.
 */
export async function scheduleBatchCollection(organizationId: string, waitMinutes: number): Promise<void> {
  const b = await getBoss();
  const seconds = Math.max(60, Math.round(waitMinutes * 60));
  await b.send(AI_BATCH_QUEUE, { kind: "collect", organizationId } satisfies AiBatchJob, {
    singletonKey: `collect:${organizationId}`, singletonSeconds: seconds, startAfter: seconds,
    retryLimit: 2, retryDelay: 60, expireInSeconds: 30 * 60,
  });
}

async function scheduleBatchPoll(batchId: string, attempt: number, afterSeconds: number): Promise<void> {
  const b = await getBoss();
  await b.send(AI_BATCH_QUEUE, { kind: "poll", batchId, attempt } satisfies AiBatchJob, {
    singletonKey: `poll:${batchId}`, singletonSeconds: afterSeconds, startAfter: afterSeconds,
    retryLimit: 2, retryDelay: 60, expireInSeconds: 30 * 60,
  });
}

// ── Enqueue ───────────────────────────────────────────────────────────
export async function enqueuePipeline(job: PipelineJob): Promise<string | null> {
  const b = await getBoss();
  return b.send(PIPELINE_QUEUE, job, {
    retryLimit:      2,
    retryDelay:      30,   // seconds
    retryBackoff:    true,
    expireInSeconds: 15 * 60,
  });
}

// ── Worker ────────────────────────────────────────────────────────────
let workerStarted = false;

// Jobs processed in parallel per replica. A bulk upload of 20 documents at
// ~1 min each would otherwise queue the last ones long enough to be reaped.
function pipelineConcurrency(): number {
  const n = Number(process.env.PIPELINE_CONCURRENCY);
  return Number.isInteger(n) && n > 0 ? Math.min(n, 10) : 3;
}

export async function startPipelineWorker(): Promise<void> {
  if (workerStarted) return;
  workerStarted = true;
  let b: PgBoss;
  try {
    b = await getBoss();
  } catch (err) {
    workerStarted = false;
    throw err;
  }
  // Handler receives a batch (array) of jobs. Process each; only THROW on
  // infrastructure failures (so pg-boss retries). runPipeline swallows its own
  // business errors and marks the document failed, so those don't retry.
  await b.work<PipelineJob>(PIPELINE_QUEUE, { localConcurrency: pipelineConcurrency() }, async (jobs) => {
    for (const job of jobs) {
      const d = job.data;
      const buffer = await getFileBuffer(d.storageKey); // throws → job retried
      await runPipeline({
        organizationId:       d.organizationId,
        subsidiaryId:         d.subsidiaryId,
        documentType:         d.documentType,
        fileName:             d.fileName,
        mimeType:             d.mimeType,
        fileBuffer:           buffer,
        requestedBy:          d.requestedBy,
        autoProcessThreshold: d.autoProcessThreshold,
        documentId:           d.documentId,
        storageKey:           d.storageKey,
        attachmentKey:        d.attachmentKey,
        precomputedExtraction: d.precomputedExtraction,
      });
    }
  });

  await b.work<AiBatchJob>(AI_BATCH_QUEUE, { localConcurrency: 1 }, async (jobs) => {
    for (const job of jobs) {
      const d = job.data;
      if (d.kind === "collect") {
        const batchId = await collectBatch(d.organizationId, enqueuePipeline);
        if (batchId) await scheduleBatchPoll(batchId, 1, 120);
      } else {
        const state = await pollBatch(d.batchId, enqueuePipeline);
        if (state === "pending") {
          if (d.attempt >= BATCH_POLL_MAX_ATTEMPTS) console.error("[ai-batch] lote sin terminar tras 24 h", d.batchId);
          else await scheduleBatchPoll(d.batchId, d.attempt + 1, BATCH_POLL_SECONDS);
        }
      }
    }
  });

  await b.work<{ caseId: string }>(CONTRACT_QUEUE, async (jobs) => {
    for (const job of jobs) {
      await processContractCase(job.data.caseId);
    }
  });

  await b.work<{ documentId: string }>(ARCHIVE_QUEUE, { localConcurrency: 1 }, async (jobs) => {
    for (const job of jobs) await indexArchiveDocument(job.data.documentId);
  });

  console.log("[pg-boss] pipeline worker started");
}
