import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { contractDocuments, contractCases } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getFileStream } from "@/lib/storage/minio";
import { Readable } from "node:stream";

// Stream a source document of a contract case (tenant-scoped).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const { id } = await params;

  const doc = await db.query.contractDocuments.findFirst({
    where: eq(contractDocuments.id, id),
    columns: { storageKey: true, mimeType: true, originalName: true, caseId: true },
  });
  if (!doc) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  // Ensure the document's case belongs to this org.
  const owned = await db.query.contractCases.findFirst({
    where: and(eq(contractCases.id, doc.caseId), eq(contractCases.organizationId, session.orgId)),
    columns: { id: true },
  });
  if (!owned) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  try {
    const nodeStream = await getFileStream(doc.storageKey);
    const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;
    const name = (doc.originalName || "documento").replace(/[^\w.\-]/g, "_");
    return new NextResponse(webStream, {
      headers: {
        "Content-Type": doc.mimeType || "application/octet-stream",
        "Content-Disposition": `inline; filename="${name}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "Error al leer el documento" }, { status: 500 });
  }
}
