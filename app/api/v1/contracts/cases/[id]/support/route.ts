import { contentDisposition, withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { Readable } from "node:stream";
import { and, eq } from "drizzle-orm";
import { getTenantSession } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { contractCases } from "@/db/schema";
import { getFileStream } from "@/lib/storage/minio";

/** Descarga el soporte adjuntado al aprobar un caso con excepción. */
async function handleGET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getTenantSession({ area: "contracts" });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const { id } = await params;
  const kase = await db.query.contractCases.findFirst({ where: and(eq(contractCases.id, id), eq(contractCases.organizationId, session.orgId)), columns: { resultJson: true } });
  const support = (kase?.resultJson as { decision?: { support?: { storageKey?: string; name?: string; mimeType?: string } } } | null)?.decision?.support;
  if (!support?.storageKey) return NextResponse.json({ error: "El caso no tiene soporte adjunto" }, { status: 404 });
  try {
    const stream = Readable.toWeb(await getFileStream(support.storageKey)) as unknown as ReadableStream<Uint8Array>;
    return new NextResponse(stream, {
      headers: {
        "Content-Type": support.mimeType || "application/octet-stream",
        "Cache-Control": "private, max-age=600",
        "Content-Disposition": contentDisposition("attachment", support.name || "soporte"),
      },
    });
  } catch {
    return NextResponse.json({ error: "No se pudo leer el soporte" }, { status: 500 });
  }
}

export const GET = withApiSecurity(handleGET);
