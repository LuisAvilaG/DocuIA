import { NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { historyDocuments } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { isFeatureEnabled } from "@/lib/features";

const DOC_LABELS: Record<string, string> = {
  invoice:        "Factura",
  purchase_order: "Orden de compra",
  xml_cfdi:       "CFDI XML",
};

const STATUS_LABELS: Record<string, string> = {
  uploaded:         "Subido",
  extracting:       "Extrayendo",
  review:           "Revisión",
  pending_approval: "Pendiente aprobación",
  approved:         "Aprobado",
  processing:       "Procesando",
  completed:        "Completado",
  failed:           "Error",
};

function csvEscape(value: string | null | undefined): string {
  const str = String(value ?? "");
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function GET() {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const enabled = await isFeatureEnabled(session.orgId, "data_export");
  if (!enabled) return NextResponse.json({ error: "Feature no disponible" }, { status: 403 });

  try {
    const rows = await db.query.historyDocuments.findMany({
      where: eq(historyDocuments.organizationId, session.orgId),
      orderBy: [desc(historyDocuments.createdAt)],
    });

    const headers = ["ID", "Tipo", "Proveedor", "Num. Doc", "Total", "Estado", "NS Doc ID", "Creado", "Actualizado"];

    const csvRows = rows.map(r => [
      String(r.id),
      DOC_LABELS[r.documentType] ?? r.documentType,
      r.vendor ?? "",
      r.numDoc ?? "",
      r.total ? String(r.total) : "",
      STATUS_LABELS[r.status] ?? r.status,
      r.netsuiteDocId ?? "",
      r.createdAt.toISOString().slice(0, 10),
      r.updatedAt.toISOString().slice(0, 10),
    ].map(csvEscape).join(","));

    const csv = [headers.join(","), ...csvRows].join("\n");
    const date = new Date().toISOString().slice(0, 10);

    return new Response(csv, {
      headers: {
        "Content-Type":        "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="historial-${date}.csv"`,
      },
    });
  } catch (err) {
    console.error("[history/export]", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
