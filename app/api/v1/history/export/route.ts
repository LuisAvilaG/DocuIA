import { NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { historyDocuments } from "@/db/schema";
import { eq, and, lt, desc } from "drizzle-orm";
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
  let str = String(value ?? "");
  // Neutralize CSV formula injection: a cell starting with = + - @ (or a control
  // char) is executed as a formula by Excel/Sheets. Prefix with a single quote.
  if (/^[=+\-@\t\r]/.test(str)) str = "'" + str;
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
    const headers = ["ID", "Tipo", "Proveedor", "Num. Doc", "Total", "Estado", "NS Doc ID", "Creado", "Actualizado"];
    const orgId = session.orgId;
    const BATCH = 2000;
    const encoder = new TextEncoder();

    // Stream the CSV in id-keyed pages so we never hold the whole table (nor the
    // per-row `products` JSON) in memory — an unbounded findMany could OOM.
    // One page per pull() so the stream respects consumer backpressure.
    let cursor: number | null = null;
    let headerSent = false;
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (!headerSent) {
          controller.enqueue(encoder.encode(headers.join(",") + "\n"));
          headerSent = true;
        }
        const where = cursor === null
          ? eq(historyDocuments.organizationId, orgId)
          : and(eq(historyDocuments.organizationId, orgId), lt(historyDocuments.id, cursor));
        const rows = await db.query.historyDocuments.findMany({
          where,
          columns: {
            id: true, documentType: true, vendor: true, numDoc: true,
            total: true, status: true, netsuiteDocId: true, createdAt: true, updatedAt: true,
          },
          orderBy: [desc(historyDocuments.id)],
          limit: BATCH,
        });
        if (rows.length === 0) { controller.close(); return; }
        for (const r of rows) {
          const line = [
            String(r.id),
            DOC_LABELS[r.documentType] ?? r.documentType,
            r.vendor ?? "",
            r.numDoc ?? "",
            r.total ? String(r.total) : "",
            STATUS_LABELS[r.status] ?? r.status,
            r.netsuiteDocId ?? "",
            r.createdAt.toISOString().slice(0, 10),
            r.updatedAt.toISOString().slice(0, 10),
          ].map(csvEscape).join(",");
          controller.enqueue(encoder.encode(line + "\n"));
        }
        cursor = rows[rows.length - 1].id;
        if (rows.length < BATCH) controller.close();
      },
    });

    const date = new Date().toISOString().slice(0, 10);
    return new Response(stream, {
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
