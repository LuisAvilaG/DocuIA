import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { exceptionQueue } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getFileBuffer } from "@/lib/storage/minio";
import { runPipeline } from "@/lib/workflow/pipeline";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  try {
    const { id } = await params;
    const exceptionId = Number(id);
    if (!Number.isFinite(exceptionId)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    }

    const exception = await db.query.exceptionQueue.findFirst({
      where: and(
        eq(exceptionQueue.id, exceptionId),
        eq(exceptionQueue.organizationId, session.orgId)
      ),
    });

    if (!exception) {
      return NextResponse.json({ error: "Excepción no encontrada" }, { status: 404 });
    }
    if (exception.status === "resolved" || exception.status === "dismissed") {
      return NextResponse.json({ error: "Esta excepción ya fue resuelta" }, { status: 409 });
    }
    if (!exception.storageKey) {
      return NextResponse.json({ error: "No hay archivo asociado para reintentar" }, { status: 422 });
    }
    if (!exception.subsidiaryId) {
      return NextResponse.json({ error: "Subsidiaria no definida en esta excepción" }, { status: 422 });
    }

    // Mark as in_progress and increment retry count
    await db.update(exceptionQueue)
      .set({
        status: "in_progress",
        retryCount: (exception.retryCount || 0) + 1,
        lastRetryAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(exceptionQueue.id, exceptionId));

    // Fetch file from storage and re-run pipeline
    const fileBuffer = await getFileBuffer(exception.storageKey);
    const originalFilename = exception.originalFilename || "document.pdf";
    const ext = originalFilename.split(".").pop()?.toLowerCase() || "";
    const MIME: Record<string, string> = {
      pdf: "application/pdf",
      png: "image/png",
      webp: "image/webp",
      tiff: "image/tiff",
      tif: "image/tiff",
    };
    const mimeType = MIME[ext] ?? "image/jpeg";

    const result = await runPipeline({
      organizationId: session.orgId,
      subsidiaryId: exception.subsidiaryId,
      documentType: (exception.documentType as "invoice" | "purchase_order" | "xml_cfdi") || "invoice",
      fileName: originalFilename,
      mimeType,
      fileBuffer,
      requestedBy: session.sub,
    });

    // Mark exception resolved if pipeline succeeded
    if (result.status !== "failed") {
      await db.update(exceptionQueue)
        .set({
          status: "resolved",
          resolvedAt: new Date(),
          resolvedBy: session.sub,
          resolutionNotes: `Reintento exitoso — nuevo documentId: ${result.documentId}`,
          updatedAt: new Date(),
        })
        .where(eq(exceptionQueue.id, exceptionId));
    } else {
      await db.update(exceptionQueue)
        .set({
          status: "pending",
          failureReason: result.error,
          updatedAt: new Date(),
        })
        .where(eq(exceptionQueue.id, exceptionId));
    }

    return NextResponse.json({ ok: true, result });

  } catch (err) {
    console.error("[exceptions/retry]", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
