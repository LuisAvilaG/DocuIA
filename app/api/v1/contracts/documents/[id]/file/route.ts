import { contentDisposition, withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { contractDocuments, contractCases } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getFileSize, getFileStream } from "@/lib/storage/minio";
import { parseByteRange } from "@/lib/storage/byte-range";
import { Readable } from "node:stream";

// Stream a source document of a contract case (tenant-scoped). It answers
// `Range` requests, so a preview reads the pages it shows and not the whole
// file: a contract can weigh more than 100 MB.
async function handleGET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getTenantSession({ area: "contracts" });
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
    // Without the size there are no ranges: the file is sent whole, as before.
    const size = await getFileSize(doc.storageKey).catch(() => null);
    const range = size === null ? null : parseByteRange(req.headers.get("range"), size);
    if (range === "unsatisfiable") return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });

    const nodeStream = await getFileStream(doc.storageKey, range ?? undefined);
    const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;
    const name = (doc.originalName || "documento").replace(/[^\w.\-]/g, "_");
    return new NextResponse(webStream, {
      status: range ? 206 : 200,
      headers: {
        "Content-Type": doc.mimeType || "application/octet-stream",
        "Content-Disposition": contentDisposition("inline", name),
        "Cache-Control": "private, max-age=3600",
        ...(size === null ? {} : { "Accept-Ranges": "bytes", "Content-Length": String(range ? range.end - range.start + 1 : size) }),
        ...(range ? { "Content-Range": `bytes ${range.start}-${range.end}/${size}` } : {}),
      },
    });
  } catch {
    return NextResponse.json({ error: "Error al leer el documento" }, { status: 500 });
  }
}

export const GET = withApiSecurity(handleGET);
