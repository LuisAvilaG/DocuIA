import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { organizations, subsidiaries } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { runPipeline } from "@/lib/workflow/pipeline";
import { isFeatureEnabled } from "@/lib/features";

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/tiff",
  "text/xml",
  "application/xml",
]);

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

export async function POST(req: NextRequest) {
  const session = await getTenantSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const subsidiaryId = String(formData.get("subsidiaryId") || "");
    const documentType = String(formData.get("documentType") || "invoice") as
      | "invoice"
      | "purchase_order"
      | "xml_cfdi";
    const isBulk = formData.get("bulk") === "true";

    if (isBulk) {
      const bulkEnabled = await isFeatureEnabled(session.orgId, "bulk_upload");
      if (!bulkEnabled) {
        return NextResponse.json({ error: "La carga masiva no está disponible en tu plan" }, { status: 403 });
      }
    }

    if (!file) {
      return NextResponse.json({ error: "Se requiere un archivo" }, { status: 400 });
    }
    if (!subsidiaryId) {
      return NextResponse.json({ error: "Se requiere subsidiaryId" }, { status: 400 });
    }
    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: `Tipo de archivo no permitido: ${file.type}` },
        { status: 415 }
      );
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "El archivo excede el límite de 20 MB" },
        { status: 413 }
      );
    }

    // Verify subsidiary belongs to this org and fetch org settings
    const [sub, org] = await Promise.all([
      db.query.subsidiaries.findFirst({
        where: and(
          eq(subsidiaries.id, subsidiaryId),
          eq(subsidiaries.organizationId, session.orgId)
        ),
      }),
      db.query.organizations.findFirst({
        where: eq(organizations.id, session.orgId),
        columns: { autoProcessThreshold: true },
      }),
    ]);
    if (!sub) {
      return NextResponse.json({ error: "Subsidiaria no válida" }, { status: 404 });
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer());

    const result = await runPipeline({
      organizationId: session.orgId,
      subsidiaryId,
      documentType,
      fileName: file.name,
      mimeType: file.type,
      fileBuffer,
      requestedBy: session.sub,
      autoProcessThreshold: org?.autoProcessThreshold ?? undefined,
    });

    if (result.status === "failed") {
      return NextResponse.json(
        { ok: false, error: result.error, documentId: result.documentId },
        { status: 500 }
      );
    }

    if (result.status === "review") {
      return NextResponse.json({
        ok: true, status: "review",
        documentId: result.documentId,
        payload: result.payload,
      });
    }

    if (result.status === "pending_approval") {
      return NextResponse.json({
        ok: true, status: "pending_approval",
        documentId: result.documentId,
      });
    }

    return NextResponse.json({
      ok: true, status: "completed",
      documentId: result.documentId,
      netsuiteId: result.netsuiteId,
      recordUrl:  result.recordUrl,
    });

  } catch (err) {
    console.error("[workflow/upload]", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
