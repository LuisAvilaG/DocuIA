import { redirect } from "next/navigation";
import { getTenantSession } from "@/lib/auth/jwt";
import { canAccessTenantArea } from "@/lib/auth/permissions";
import { requireApAutomation } from "@/lib/products";
import { isFeatureEnabled } from "@/lib/features";
import { db } from "@/lib/db";
import { exceptionQueue, historyDocuments } from "@/db/schema";
import { and, eq, desc, inArray } from "drizzle-orm";
import { ExceptionsClient, type ExRow } from "./client";

export default async function ExceptionsPage() {
  const session = await getTenantSession({ area: "documents" });
  if (!session) redirect("/login");
  await requireApAutomation(session.orgId);
  if (!await isFeatureEnabled(session.orgId, "exception_queue")) redirect("/dashboard");

  let exceptions: ExRow[] = [];
  try {
    const rows = await db.query.exceptionQueue.findMany({
      where: eq(exceptionQueue.organizationId, session.orgId),
      orderBy: [desc(exceptionQueue.createdAt)],
      limit: 200,
    });
    const docIds = [...new Set(rows.map((r) => r.documentId).filter((x): x is number => x != null))];
    const docs = docIds.length
      ? await db.select({ id: historyDocuments.id, numDoc: historyDocuments.numDoc, vendor: historyDocuments.vendor, total: historyDocuments.total, status: historyDocuments.status })
        .from(historyDocuments).where(and(eq(historyDocuments.organizationId, session.orgId), inArray(historyDocuments.id, docIds)))
      : [];
    const docBy = new Map(docs.map((d) => [d.id, d]));
    exceptions = rows.map((r) => {
      const d = r.documentId != null ? docBy.get(r.documentId) : undefined;
      return {
        id: r.id,
        documentId: d ? d.id : null,
        numDoc: d?.numDoc ?? null,
        vendor: d?.vendor ?? null,
        total: d?.total != null ? Number(d.total) : null,
        documentType: r.documentType,
        originalFilename: r.originalFilename,
        failureStage: r.failureStage,
        failureReason: r.failureReason,
        errorCode: r.errorCode,
        status: r.status,
        retryCount: r.retryCount,
        lastRetryAt: r.lastRetryAt?.toISOString() ?? null,
        canRetry: Boolean(r.storageKey && r.subsidiaryId),
        createdAt: r.createdAt.toISOString(),
      };
    });
  } catch (err) {
    console.error("[exceptions]", err);
  }

  const canAct = canAccessTenantArea(session.role, { area: "documents", permission: "write" });
  return <ExceptionsClient exceptions={exceptions} canAct={canAct} />;
}
