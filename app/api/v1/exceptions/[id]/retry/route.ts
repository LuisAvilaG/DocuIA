import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { exceptionQueue, historyDocuments } from "@/db/schema";
import { eq, and, inArray, lt, or } from "drizzle-orm";
import { getFileBuffer } from "@/lib/storage/minio";
import { runPipeline } from "@/lib/workflow/pipeline";

type Params = { params: Promise<{ id: string }> };

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  tiff: "image/tiff",
  tif: "image/tiff",
  xml: "application/xml",
};

// A retry that died mid-run (deploy, crash) may be claimed again after this.
const STALE_RETRY_MS = 15 * 60_000;

async function handlePOST(_req: NextRequest, { params }: Params) {
  const session = await getTenantSession({ area: "documents", permission: "write" });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { id } = await params;
  const exceptionId = Number(id);
  if (!Number.isSafeInteger(exceptionId)) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }

  const exception = await db.query.exceptionQueue.findFirst({
    where: and(eq(exceptionQueue.id, exceptionId), eq(exceptionQueue.organizationId, session.orgId)),
  });
  if (!exception) return NextResponse.json({ error: "Excepción no encontrada" }, { status: 404 });
  if (exception.status === "resolved" || exception.status === "dismissed") {
    return NextResponse.json({ error: "Esta excepción ya fue resuelta" }, { status: 409 });
  }
  if (!exception.storageKey) {
    return NextResponse.json({ error: "No hay archivo asociado para reintentar" }, { status: 422 });
  }
  if (!exception.subsidiaryId) {
    return NextResponse.json({ error: "Subsidiaria no definida en esta excepción" }, { status: 422 });
  }

  // Claim the exception so two clicks do not run the pipeline twice.
  const claimed = await db.update(exceptionQueue)
    .set({ status: "in_progress", retryCount: (exception.retryCount || 0) + 1, lastRetryAt: new Date(), updatedAt: new Date() })
    .where(and(
      eq(exceptionQueue.id, exceptionId),
      or(
        inArray(exceptionQueue.status, ["pending"]),
        and(eq(exceptionQueue.status, "in_progress"), lt(exceptionQueue.updatedAt, new Date(Date.now() - STALE_RETRY_MS))),
      ),
    ))
    .returning({ id: exceptionQueue.id });
  if (!claimed.length) return NextResponse.json({ error: "Este documento ya se está reintentando." }, { status: 409 });

  try {
    let fileBuffer: Buffer;
    try {
      fileBuffer = await getFileBuffer(exception.storageKey);
    } catch {
      // Typically removed by the retention policy: nothing left to retry.
      await db.update(exceptionQueue)
        .set({ status: "pending", failureReason: "El archivo original ya no está disponible en el almacenamiento. Súbelo de nuevo.", updatedAt: new Date() })
        .where(eq(exceptionQueue.id, exceptionId));
      return NextResponse.json({ error: "El archivo original ya no está disponible. Súbelo de nuevo." }, { status: 410 });
    }

    const originalFilename = exception.originalFilename || "document.pdf";
    const ext = originalFilename.split(".").pop()?.toLowerCase() || "";

    // Reprocess the same history document when it is linked and still failed,
    // so NetSuite sees the same external_id; older exceptions create a new one.
    const linked = exception.documentId
      ? await db.query.historyDocuments.findFirst({
          where: and(
            eq(historyDocuments.id, exception.documentId),
            eq(historyDocuments.organizationId, session.orgId),
            eq(historyDocuments.status, "failed"),
          ),
          columns: { id: true },
        })
      : undefined;

    const result = await runPipeline({
      organizationId: session.orgId,
      subsidiaryId:   exception.subsidiaryId,
      documentType:   (exception.documentType as "invoice" | "purchase_order" | "xml_cfdi") || "invoice",
      fileName:       originalFilename,
      mimeType:       MIME[ext] ?? "image/jpeg",
      fileBuffer,
      requestedBy:    session.sub,
      documentId:     linked?.id,
      storageKey:     linked ? exception.storageKey : undefined,
      exceptionId,
    });

    // Extraction and processing worked; a document now in review or pending
    // approval continues in the normal workflow, not in the exception queue.
    if (result.status !== "failed") {
      await db.update(exceptionQueue)
        .set({
          status: "resolved",
          documentId: result.documentId,
          resolvedAt: new Date(),
          resolvedBy: session.sub,
          resolutionNotes: `Reintento exitoso — documento #${result.documentId} (${result.status})`,
          updatedAt: new Date(),
        })
        .where(eq(exceptionQueue.id, exceptionId));
    }
    // On failure runPipeline already moved this exception back to pending.

    return NextResponse.json({ ok: true, result });
  } catch (err) {
    console.error("[exceptions/retry]", err);
    await db.update(exceptionQueue)
      .set({ status: "pending", updatedAt: new Date() })
      .where(and(eq(exceptionQueue.id, exceptionId), eq(exceptionQueue.status, "in_progress")))
      .catch(() => {});
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

export const POST = withApiSecurity(handlePOST);
