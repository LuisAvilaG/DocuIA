import { redirect } from "next/navigation";
import { getTenantSession } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { subsidiaries, historyDocuments } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { WorkflowUploadClient } from "./client";

async function getWorkflowData(orgId: string) {
  try {
    const [subs, recentDocs] = await Promise.all([
      db.query.subsidiaries.findMany({
        where: eq(subsidiaries.organizationId, orgId),
        columns: { id: true, name: true },
      }),
      db.query.historyDocuments.findMany({
        where: eq(historyDocuments.organizationId, orgId),
        columns: {
          id: true, documentType: true, status: true, vendor: true,
          numDoc: true, total: true, fallbackUsed: true, createdAt: true,
        },
        orderBy: [desc(historyDocuments.createdAt)],
        limit: 20,
      }),
    ]);
    return { subs, recentDocs };
  } catch {
    return { subs: [], recentDocs: [] };
  }
}

export default async function WorkflowPage() {
  const session = await getTenantSession();
  if (!session) redirect("/login");

  const { subs, recentDocs } = await getWorkflowData(session.orgId);

  return (
    <WorkflowUploadClient
      subsidiaries={subs.map(s => ({ id: s.id, name: s.name }))}
      recentDocs={recentDocs.map(d => ({
        id:           d.id,
        documentType: d.documentType,
        status:       d.status,
        vendor:       d.vendor,
        numDoc:       d.numDoc,
        total:        d.total ? Number(d.total) : null,
        fallbackUsed: d.fallbackUsed,
        createdAt:    d.createdAt.toISOString(),
      }))}
    />
  );
}
