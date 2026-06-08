import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { historyDocuments } from "@/db/schema";
import { and, eq } from "drizzle-orm";

type Params = { params: Promise<{ docId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { docId } = await params;
  const id = parseInt(docId, 10);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 });

  try {
    const doc = await db.query.historyDocuments.findFirst({
      where: and(
        eq(historyDocuments.id, id),
        eq(historyDocuments.organizationId, session.orgId),
      ),
      columns: {
        id: true,
        status: true,
        vendor: true,
        numDoc: true,
        total: true,
        documentType: true,
        fallbackUsed: true,
        netsuiteDocId: true,
        errorMessage: true,
        updatedAt: true,
      },
    });

    if (!doc) return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 });

    return NextResponse.json(doc);
  } catch (err) {
    console.error("[workflow/status]", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
