import { PgBoss } from "pg-boss";
import { runPipeline } from "@/lib/workflow/pipeline";
import { getFileBuffer } from "@/lib/storage/minio";
import { processContractCase } from "@/lib/contracts/pipeline";

export const PIPELINE_QUEUE = "document-pipeline";
export const CONTRACT_QUEUE = "contract-pipeline";

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
    boss = b;
    return b;
  })();
  return booting;
}

export async function enqueueContractCase(caseId: string): Promise<string | null> {
  const b = await getBoss();
  return b.send(CONTRACT_QUEUE, { caseId }, { retryLimit: 2, retryDelay: 30, retryBackoff: true, expireInSeconds: 20 * 60 });
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

export async function startPipelineWorker(): Promise<void> {
  if (workerStarted) return;
  workerStarted = true;
  const b = await getBoss();
  // Handler receives a batch (array) of jobs. Process each; only THROW on
  // infrastructure failures (so pg-boss retries). runPipeline swallows its own
  // business errors and marks the document failed, so those don't retry.
  await b.work<PipelineJob>(PIPELINE_QUEUE, async (jobs) => {
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
      });
    }
  });

  await b.work<{ caseId: string }>(CONTRACT_QUEUE, async (jobs) => {
    for (const job of jobs) {
      await processContractCase(job.data.caseId);
    }
  });

  console.log("[pg-boss] pipeline worker started");
}
