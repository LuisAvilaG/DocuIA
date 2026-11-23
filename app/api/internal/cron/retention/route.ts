import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { historyDocuments, exceptionQueue, workflowRuntimeLogs, aiBatchItems, statusEvents } from "@/db/schema";
import { and, eq, inArray, lt } from "drizzle-orm";
import { getFeature } from "@/lib/features";
import { deleteFile } from "@/lib/storage/minio";
import { purgeExpiredOrganizations } from "@/lib/admin/purge-org";

function cronAuth(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("x-cron-secret") === secret;
}

async function handleGET(req: NextRequest) {
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
            // Files first. With the row deleted first, a file that failed to
            // delete stayed in storage for good: nothing pointed at it any more.
            const [stored, pending] = await Promise.all([
              db.query.historyDocuments.findFirst({
                where: and(eq(historyDocuments.id, document.id), eq(historyDocuments.organizationId, org.id), inArray(historyDocuments.status, ["completed", "failed"])),
                columns: { storageKey: true, attachmentKey: true },
              }),
              db.select({ storageKey: exceptionQueue.storageKey }).from(exceptionQueue)
                .where(and(eq(exceptionQueue.documentId, document.id), eq(exceptionQueue.organizationId, org.id))),
            ]);
            if (!stored) continue;
            let fileFailed = false;
            // Each file on its own: one that is already gone must not leave the others behind.
            for (const key of new Set([stored.storageKey, stored.attachmentKey, ...pending.map((e) => e.storageKey)])) {
              if (!key) continue;
              try {
                await deleteFile(key);
                filesDeleted++;
              } catch (err) {
                if ((err as { name?: string } | null)?.name === "NoSuchKey") continue;
                fileFailed = true;
                errors++;
                console.error("[cron/retention] file cleanup failed", { orgId: org.id, documentId: document.id, err });
              }
            }
            // The document stays a candidate, so tomorrow's run tries its files again.
            if (fileFailed) continue;
            // The exception rows that point at the document go in the same
            // transaction, so the queue never lists a document that is gone.
            const keys = await db.transaction(async (tx) => {
              const [removed] = await tx.delete(historyDocuments).where(and(
                eq(historyDocuments.id, document.id),
                eq(historyDocuments.organizationId, org.id),
                inArray(historyDocuments.status, ["completed", "failed"]),
              )).returning({ storageKey: historyDocuments.storageKey, attachmentKey: historyDocuments.attachmentKey });
              if (!removed) return null;
              const exceptions = await tx.delete(exceptionQueue).where(and(
                eq(exceptionQueue.documentId, document.id),
                eq(exceptionQueue.organizationId, org.id),
              )).returning({ storageKey: exceptionQueue.storageKey });
              // Rows with no foreign key to the document: its batch item keeps the
              // whole file job and the model's answer, and its status history
              // would otherwise outlive the retention period too.
              await tx.delete(aiBatchItems).where(and(eq(aiBatchItems.documentId, document.id), eq(aiBatchItems.organizationId, org.id)));
              await tx.delete(statusEvents).where(and(eq(statusEvents.organizationId, org.id), eq(statusEvents.entity, "document"), eq(statusEvents.entityId, String(document.id))));
              return [removed.storageKey, removed.attachmentKey, ...exceptions.map((e) => e.storageKey)];
            });
            if (!keys) continue;
            documentsDeleted++;
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

    // Organizations a platform admin deleted more than 30 days ago.
    const purged = await purgeExpiredOrganizations();

    return NextResponse.json({ ok: true, summary, purged });
  } catch (err) {
    console.error("[cron/retention]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export const GET = withApiSecurity(handleGET);
