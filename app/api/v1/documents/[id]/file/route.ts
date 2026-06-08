import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { historyDocuments } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getFileBuffer } from "@/lib/storage/minio";
import path from "path";

const MIME_MAP: Record<string, string> = {
  pdf:  "application/pdf",
  jpg:  "image/jpeg",
  jpeg: "image/jpeg",
  png:  "image/png",
  webp: "image/webp",
  tiff: "image/tiff",
  tif:  "image/tiff",
  xml:  "application/xml",
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { id } = await params;
  const docId = parseInt(id, 10);
  if (isNaN(docId)) return NextResponse.json({ error: "ID inválido" }, { status: 400 });

  let doc;
  try {
    doc = await db.query.historyDocuments.findFirst({
      where: and(
        eq(historyDocuments.id, docId),
        eq(historyDocuments.organizationId, session.orgId),
      ),
      columns: { storageKey: true },
    });
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }

  if (!doc?.storageKey) {
    return NextResponse.json({ error: "Archivo no disponible" }, { status: 404 });
  }

  const ext = path.extname(doc.storageKey).slice(1).toLowerCase();
  const contentType = MIME_MAP[ext] ?? "application/octet-stream";

  try {
    const buffer = await getFileBuffer(doc.storageKey);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type":        contentType,
        "Content-Length":      String(buffer.length),
        "Cache-Control":       "private, max-age=3600",
        "Content-Disposition": "inline",
      },
    });
  } catch {
    return NextResponse.json({ error: "Error al leer el archivo" }, { status: 500 });
  }
}
