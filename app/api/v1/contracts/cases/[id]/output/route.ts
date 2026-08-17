import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { contractCases } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getFileStream } from "@/lib/storage/minio";
import { Readable } from "node:stream";
import { isFeatureEnabled } from "@/lib/features";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!await isFeatureEnabled(session.orgId, "contract_document_generation")) {
    return NextResponse.json({ error: "La generación documental no está habilitada para este cliente." }, { status: 403 });
  }

  const { id } = await params;
  const kase = await db.query.contractCases.findFirst({
    where: and(eq(contractCases.id, id), eq(contractCases.organizationId, session.orgId)),
    columns: { resultJson: true },
  });
  const outputKey = (kase?.resultJson as { outputKey?: string } | null)?.outputKey;
  if (!outputKey) return NextResponse.json({ error: "Documento no generado" }, { status: 404 });

  try {
    const nodeStream = await getFileStream(outputKey);
    const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;
    return new NextResponse(webStream, {
      headers: {
        "Content-Type": "application/pdf",
        "Cache-Control": "private, max-age=3600",
        "Content-Disposition": `inline; filename="contrato-${id.slice(0, 8)}.pdf"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "Error al leer el documento" }, { status: 500 });
  }
}
