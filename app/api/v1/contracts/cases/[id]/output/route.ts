import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { contractCases } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getFileBuffer, getFileStream } from "@/lib/storage/minio";
import { Readable } from "node:stream";
import { isFeatureEnabled } from "@/lib/features";
import { logAudit } from "@/lib/audit/log";
import { convertWordToPdf } from "@/lib/contracts/word-to-pdf";

const WORD_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PDF_MIME = "application/pdf";

function safeName(value: string) {
  return value.replace(/[\r\n"]/g, "");
}

function pdfName(value: string) {
  return `${value.replace(/\.docx$/i, "")}.pdf`;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
  const sourceIsWord = result?.outputMime === WORD_MIME;
  const format = req.nextUrl.searchParams.get("format") ?? (sourceIsWord ? "word" : "pdf");

  if (format !== "word" && format !== "pdf") {
    return NextResponse.json({ error: "Formato de descarga inválido." }, { status: 400 });
  }
  if (format === "word" && !sourceIsWord) {
    return NextResponse.json({ error: "Este documento se generó como PDF y no tiene una versión Word editable." }, { status: 400 });
  }
  await logAudit({ orgId: session.orgId, userId: session.sub, userEmail: session.email, action: "contract.output_viewed", resourceType: "contract_case", resourceId: id });

  try {
    if (format === "pdf" && sourceIsWord) {
      const pdf = await convertWordToPdf(await getFileBuffer(outputKey), result?.outputName || `contrato-${id.slice(0, 8)}.docx`);
      return new NextResponse(new Uint8Array(pdf), {
        headers: {
          "Content-Type": PDF_MIME,
          "Cache-Control": "private, max-age=3600",
          "Content-Disposition": `attachment; filename="${safeName(pdfName(result?.outputName || `contrato-${id.slice(0, 8)}.docx`))}"`,
        },
      });
    }

    const nodeStream = await getFileStream(outputKey);
    const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;
    return new NextResponse(webStream, {
      headers: {
        "Content-Type": result?.outputMime || PDF_MIME,
        "Cache-Control": "private, max-age=3600",
        "Content-Disposition": `attachment; filename="${safeName(result?.outputName || `contrato-${id.slice(0, 8)}.pdf`)}"`,
      },
    });
  } catch {
    return NextResponse.json({ error: format === "pdf" && sourceIsWord ? "No fue posible preparar la versión PDF." : "Error al leer el documento" }, { status: 500 });
  }
}
