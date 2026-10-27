import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { contractLargeUploads, historyDocuments } from "@/db/schema";
import { and, inArray, lt, or, eq, sql } from "drizzle-orm";
import { PIPELINE_QUEUE } from "@/lib/queue";
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

async function handleGET(req: NextRequest) {
  if (!cronAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const stuckMinutes = Number(process.env.STUCK_DOC_MINUTES) || 15;
    const cutoff = new Date(Date.now() - stuckMinutes * 60_000);

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
        or(inArray(historyDocuments.status, ["extracting", "processing"]), and(eq(historyDocuments.status, "uploaded"), noLiveJob)),
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
    return NextResponse.json({ ok: true, reaped, expiredUploads, thresholdMinutes: stuckMinutes });
  } catch (err) {
    console.error("[cron/reap-stuck]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export const GET = withApiSecurity(handleGET);
