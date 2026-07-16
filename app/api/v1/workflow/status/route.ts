import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { historyDocuments } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";

// Batch status endpoint: the workflow poller fetches all active documents in a
// single request instead of one request per document per tick.
export async function GET(req: NextRequest) {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const ids = (req.nextUrl.searchParams.get("ids") ?? "")
    .split(",")
    .map((s) => parseInt(s, 10))
    .filter((n) => Number.isFinite(n))
    .slice(0, 100);

  if (ids.length === 0) return NextResponse.json({ documents: [] });

  try {
    const documents = await db.query.historyDocuments.findMany({
      where: and(
        eq(historyDocuments.organizationId, session.orgId),
        inArray(historyDocuments.id, ids),
      ),
      columns: {
        id: true, status: true, vendor: true, numDoc: true, total: true,
        documentType: true, fallbackUsed: true, netsuiteDocId: true, updatedAt: true,
      },
    });
    return NextResponse.json({ documents });
  } catch (err) {
    console.error("[workflow/status batch]", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
