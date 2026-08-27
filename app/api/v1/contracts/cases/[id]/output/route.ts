import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { contractCases } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getFileStream } from "@/lib/storage/minio";
import { Readable } from "node:stream";
import { isFeatureEnabled } from "@/lib/features";
import { logAudit } from "@/lib/audit/log";

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
  const result = (kase?.resultJson as { outputKey?: string; outputMime?: string; outputName?: string } | null);
  const outputKey = result?.outputKey;
  if (!outputKey) return NextResponse.json({ error: "Documento no generado" }, { status: 404 });
  await logAudit({ orgId: session.orgId, userId: session.sub, userEmail: session.email, action: "contract.output_viewed", resourceType: "contract_case", resourceId: id });

  try {
    const nodeStream = await getFileStream(outputKey);
    const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;
    return new NextResponse(webStream, {
      headers: {
        "Content-Type": result?.outputMime || "application/pdf",
        "Cache-Control": "private, max-age=3600",
        "Content-Disposition": `${result?.outputMime === "application/pdf" ? "inline" : "attachment"}; filename="${(result?.outputName || `contrato-${id.slice(0, 8)}.pdf`).replace(/[\r\n"]/g, "")}"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "Error al leer el documento" }, { status: 500 });
  }
}
