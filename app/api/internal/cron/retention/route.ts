import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { historyDocuments, workflowRuntimeLogs } from "@/db/schema";
import { and, eq, inArray, lt } from "drizzle-orm";
import { getFeature } from "@/lib/features";
import { deleteFile } from "@/lib/storage/minio";

function cronAuth(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("x-cron-secret") === secret;
}

export async function GET(req: NextRequest) {
  if (!cronAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const orgs = await db.query.organizations.findMany({
      columns: { id: true },
    });

    const summary: Record<string, { documents: number; files: number; logs: number; errors: number }> = {};

    for (const org of orgs) {
      let feat;
      try {
        feat = await getFeature(org.id, "data_retention");
      } catch {
        continue;
      }
      if (!feat.isEnabled) continue;

      const config = feat.config as {
        documents_retention_days?: number;
        logs_retention_days?:    number;
      };

      const documentsDays = config.documents_retention_days ?? -1;
      const logsDays    = config.logs_retention_days    ?? 90;

      let documentsDeleted = 0;
      let filesDeleted = 0;
      let logsDeleted    = 0;
      let errors = 0;

      if (documentsDays > 0) {
        const cutoff = new Date(Date.now() - documentsDays * 86400_000);
        // Keep active review/approval records. Claim each terminal record with
        // a conditional delete before touching storage: a document that was
        // retried after the candidate query can never lose its active file.
        const candidates = await db.query.historyDocuments.findMany({
          where: and(
            eq(historyDocuments.organizationId, org.id),
            lt(historyDocuments.createdAt, cutoff),
            inArray(historyDocuments.status, ["completed", "failed"]),
          ),
          columns: { id: true },
          limit: 250,
        });
        for (const document of candidates) {
          try {
            const [removed] = await db.delete(historyDocuments).where(and(
              eq(historyDocuments.id, document.id),
              eq(historyDocuments.organizationId, org.id),
              inArray(historyDocuments.status, ["completed", "failed"]),
            )).returning({ storageKey: historyDocuments.storageKey });
            if (!removed) continue;
            documentsDeleted++;
            if (removed.storageKey) {
              await deleteFile(removed.storageKey);
              filesDeleted++;
            }
          } catch (err) {
            errors++;
            console.error("[cron/retention] document cleanup failed", { orgId: org.id, documentId: document.id, err });
          }
        }
      }

      if (logsDays > 0) {
        const cutoff = new Date(Date.now() - logsDays * 86400_000);
        const result = await db.delete(workflowRuntimeLogs)
          .where(and(
            eq(workflowRuntimeLogs.organizationId, org.id),
            lt(workflowRuntimeLogs.createdAt, cutoff),
          ));
        logsDeleted = (result as { rowCount?: number }).rowCount ?? 0;
      }

      summary[org.id] = { documents: documentsDeleted, files: filesDeleted, logs: logsDeleted, errors };
    }

    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    console.error("[cron/retention]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
