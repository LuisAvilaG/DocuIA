import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { historyDocuments } from "@/db/schema";
import { and, inArray, lt, or, eq, sql } from "drizzle-orm";
import { PIPELINE_QUEUE } from "@/lib/queue";

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
    return NextResponse.json({ ok: true, reaped, thresholdMinutes: stuckMinutes });
  } catch (err) {
    console.error("[cron/reap-stuck]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export const GET = withApiSecurity(handleGET);
