import { redirect } from "next/navigation";
import { getTenantSession } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { historyDocuments } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { HistoryTableClient } from "./client";

export default async function HistoryPage() {
  const session = await getTenantSession();
  if (!session) redirect("/login");

  let docs: {
    id: number; documentType: string; status: string; vendor: string | null;
    numDoc: string | null; total: number | null; createdAt: string; updatedAt: string;
  }[] = [];

  try {
    const rows = await db.query.historyDocuments.findMany({
      where: eq(historyDocuments.organizationId, session.orgId),
      orderBy: [desc(historyDocuments.createdAt)],
      limit: 200,
    });
    docs = rows.map(r => ({
      id:           r.id,
      documentType: r.documentType,
      status:       r.status,
      vendor:       r.vendor,
      numDoc:       r.numDoc,
      total:        r.total ? Number(r.total) : null,
      createdAt:    r.createdAt.toISOString(),
      updatedAt:    r.updatedAt.toISOString(),
    }));
  } catch (err) {
    console.error("[history]", err);
  }

  return <HistoryTableClient docs={docs} />;
}
