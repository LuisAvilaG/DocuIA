import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { contractCases, contractLargeUploads, historyDocuments } from "@/db/schema";
import { and, inArray, lt, or, eq, sql } from "drizzle-orm";
import { CONTRACT_QUEUE, PIPELINE_QUEUE, enqueueContractCase } from "@/lib/queue";
import { abortMultipartFile, deleteFile } from "@/lib/storage/minio";

function cronAuth(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("x-cron-secret") === secret;
}

// Documents that die mid-pipeline (deploy, OOM, crash) get stranded in a
// transient status forever, and the frontend polls them indefinitely. This
// watchdog fails any document left in a transient state past the threshold.
// With per-call timeouts (Gemini/NetSuite) no healthy document should ever sit
// in these states this long, so the threshold is generous.
const TRANSIENT_STATES = ["uploaded", "extracting", "processing"] as const;

// "uploaded" documents may simply be waiting their turn in the queue; only
// those without a live pg-boss job are really stranded.
const noLiveJob = sql`NOT EXISTS (
  SELECT 1 FROM pgboss.job j
  WHERE j.name = ${PIPELINE_QUEUE}
    AND j.state IN ('created', 'retry', 'active')
    AND j.data->>'documentId' = ${historyDocuments.id}::text
)`;

// Bulk uploads wait as batch items (no pipeline job) until the provider's batch
// ends, which can take hours. Past a day the batch is given up on.
const notWaitingOnBatch = sql`NOT EXISTS (
  SELECT 1 FROM ai_batch_items i
  WHERE i.document_id = ${historyDocuments.id}
    AND i.status IN ('pending', 'submitted')
    AND i.created_at > now() - interval '26 hours'
)`;

// Contract cases have their own queue. One left "uploaded" or "processing"
// with no job alive (the enqueue failed after the commit, or the job died and
// ran out of retries) showed "Analizando" forever.
const noLiveCaseJob = sql`NOT EXISTS (
  SELECT 1 FROM pgboss.job j
  WHERE j.name = ${CONTRACT_QUEUE}
    AND j.state IN ('created', 'retry', 'active')
    AND j.data->>'caseId' = ${contractCases.id}::text
)`;
const STUCK_CASE_MINUTES = 30;

async function reapContractCases(): Promise<{ requeued: number; failed: number }> {
  const cutoff = new Date(Date.now() - STUCK_CASE_MINUTES * 60_000);
  const stranded = await db.select({ id: contractCases.id, status: contractCases.status }).from(contractCases)
    .where(and(inArray(contractCases.status, ["uploaded", "processing"]), lt(contractCases.updatedAt, cutoff), noLiveCaseJob))
    .limit(50);
  let requeued = 0, failed = 0;
  for (const kase of stranded) {
    try {
      if (kase.status === "uploaded") {
        // Never started: start it.
        await enqueueContractCase(kase.id);
        requeued++;
      } else {
        // Started and died after its retries: running it again could repeat whatever killed it.
        const moved = await db.update(contractCases)
          .set({ status: "failed", errorMessage: "El análisis se interrumpió antes de terminar. Vuelve a enviar los documentos del caso.", updatedAt: new Date() })
          .where(and(eq(contractCases.id, kase.id), eq(contractCases.status, "processing")))
          .returning({ id: contractCases.id });
        failed += moved.length;
      }
    } catch (error) {
      console.error("[cron/reap-stuck] contract case", kase.id, error);
    }
  }
  return { requeued, failed };
}

async function handleGET(req: NextRequest) {
  if (!cronAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const stuckMinutes = Number(process.env.STUCK_DOC_MINUTES) || 15;
    const cutoff = new Date(Date.now() - stuckMinutes * 60_000);
    // A slow provider can keep one healthy reading busy for longer than the
    // threshold (two models, each with its retries). While its job is alive the
    // document is left alone, up to this limit: failed under a running job, the
    // user retried it and two runs worked on the same document.
    const hardCutoff = new Date(Date.now() - Math.max(stuckMinutes, 45) * 60_000);

    const result = await db.update(historyDocuments)
      .set({
        status:       "failed",
        errorMessage: `Procesamiento interrumpido (sin actividad por más de ${stuckMinutes} min). ` +
                      `Si el registro se creó en NetSuite, verifícalo por externalId antes de reintentar.`,
        updatedAt:    new Date(),
      })
      .where(and(
        inArray(historyDocuments.status, [...TRANSIENT_STATES]),
        lt(historyDocuments.updatedAt, cutoff),
        or(
          and(inArray(historyDocuments.status, ["extracting", "processing"]), or(noLiveJob, lt(historyDocuments.updatedAt, hardCutoff))),
          and(eq(historyDocuments.status, "uploaded"), noLiveJob, notWaitingOnBatch),
        ),
      ));

    const reaped = (result as unknown as { rowCount?: number }).rowCount ?? 0;
    // Multipart sessions are not documents. An interrupted browser upload must
    // not retain 150 MB of unused parts in MinIO indefinitely.
    const uploadCutoff = new Date(Date.now() - 24 * 60 * 60_000);
    const staleUploads = await db.query.contractLargeUploads.findMany({ where: and(inArray(contractLargeUploads.status, ["uploading", "completed"]), lt(contractLargeUploads.createdAt, uploadCutoff)), limit: 50 });
    let expiredUploads = 0;
    for (const upload of staleUploads) {
      const locked = await db.update(contractLargeUploads).set({ status: "expiring" }).where(and(eq(contractLargeUploads.id, upload.id), eq(contractLargeUploads.status, upload.status))).returning({ id: contractLargeUploads.id });
      if (!locked.length) continue;
      try {
        if (upload.status === "uploading") await abortMultipartFile(upload.storageKey, upload.multipartId);
        else await deleteFile(upload.storageKey);
        await db.update(contractLargeUploads).set({ status: "expired" }).where(eq(contractLargeUploads.id, upload.id));
        expiredUploads++;
      } catch (error) {
        await db.update(contractLargeUploads).set({ status: upload.status }).where(eq(contractLargeUploads.id, upload.id));
        console.error("[cron/reap-stuck] upload cleanup failed", upload.id, error);
      }
    }
    const cases = await reapContractCases();
    // Nothing else removes expired counters, and every login, upload and API
    // key adds rows.
    await db.execute(sql`DELETE FROM rate_limits WHERE expires_at < now() - interval '1 day'`).catch((error) => console.error("[cron/reap-stuck] rate_limits", error));
    return NextResponse.json({ ok: true, reaped, expiredUploads, contractCases: cases, thresholdMinutes: stuckMinutes });
  } catch (err) {
    console.error("[cron/reap-stuck]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export const GET = withApiSecurity(handleGET);
