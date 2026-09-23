import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { Readable } from "node:stream";
import { eq } from "drizzle-orm";
import { getTenantSession } from "@/lib/auth/jwt";
import { canReviewExpenses } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { expenseDocuments } from "@/db/schema";
import { getFileStream } from "@/lib/storage/minio";

// Receipt attached to an expense line: visible to its submitter and to the
// people who review the organization's expenses.
async function handleGET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getTenantSession({ area: "expenses" });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { id } = await params;
  const documentId = Number(id);
  if (!Number.isSafeInteger(documentId)) return NextResponse.json({ error: "ID inválido" }, { status: 400 });

  const document = await db.query.expenseDocuments.findFirst({
    where: eq(expenseDocuments.id, documentId),
    columns: { fileKey: true, mimeType: true },
    with: { item: { columns: { id: true }, with: { report: { columns: { organizationId: true, submitterId: true } } } } },
  });
  const report = document?.item?.report;
  if (!document?.fileKey || !report || report.organizationId !== session.orgId
    || (!canReviewExpenses(session.role) && report.submitterId !== session.sub)) {
    return NextResponse.json({ error: "Comprobante no encontrado" }, { status: 404 });
  }

  try {
    const stream = Readable.toWeb(await getFileStream(document.fileKey)) as unknown as ReadableStream<Uint8Array>;
    return new NextResponse(stream, {
      headers: {
        "Content-Type":        document.mimeType ?? "application/octet-stream",
        "Content-Disposition": "inline",
      },
    });
  } catch {
    return NextResponse.json({ error: "Error al leer el comprobante" }, { status: 500 });
  }
}

export const GET = withApiSecurity(handleGET);
