import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { isFeatureEnabled } from "@/lib/features";
import { db } from "@/lib/db";
import { expenseReports, expenseItems } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";

const STATUS_LABELS: Record<string, string> = {
  draft:        "Borrador",
  submitted:    "Enviado",
  under_review: "En revisión",
  approved:     "Aprobado",
  rejected:     "Rechazado",
  syncing:      "Sincronizando",
  synced:       "Sincronizado",
  exception:    "Excepción",
};

const PAYMENT_LABELS: Record<string, string> = {
  personal:           "Pago personal",
  company_pays_vendor: "Empresa → Proveedor",
};

function csvEscape(v: string | null | undefined): string {
  const s = String(v ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET(req: NextRequest) {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  if (!await isFeatureEnabled(session.orgId, "expense_management")) {
    return NextResponse.json({ error: "Módulo de gastos no activado" }, { status: 403 });
  }

  const reports = await db.query.expenseReports.findMany({
    where: eq(expenseReports.organizationId, session.orgId),
    with: {
      submitter: { columns: { fullName: true, email: true } },
      items: {
        with: {
          category: { columns: { name: true } },
          department: { columns: { name: true } },
        },
      },
    },
    orderBy: desc(expenseReports.createdAt),
  });

  const headerReport = ["ID Informe", "Propósito", "Empleado", "Email", "Período inicio", "Período fin", "Estado", "Enviado el", "Aprobado el", "NS ID", "# Líneas", "Total Informe"].join(",");
  const headerItem = ["ID Informe", "# Línea", "Categoría", "Departamento", "Proveedor", "NIT/RFC", "# Factura", "Fecha factura", "Subtotal", "Impuesto", "Retención", "Total", "Moneda", "Forma pago", "Tipo documento", "NS Record ID", "Error sync"].join(",");

  const reportRows = reports.map(r => {
    const total = r.items.reduce((sum, i) => sum + Number(i.total ?? 0), 0);
    return [
      csvEscape(r.id),
      csvEscape(r.purpose),
      csvEscape(r.submitter?.fullName),
      csvEscape(r.submitter?.email),
      csvEscape(r.periodStart ? new Date(r.periodStart).toLocaleDateString("es-CO") : ""),
      csvEscape(r.periodEnd   ? new Date(r.periodEnd).toLocaleDateString("es-CO")   : ""),
      csvEscape(STATUS_LABELS[r.status] ?? r.status),
      csvEscape(r.submittedAt ? new Date(r.submittedAt).toLocaleDateString("es-CO") : ""),
      csvEscape(r.approvedAt  ? new Date(r.approvedAt).toLocaleDateString("es-CO")  : ""),
      csvEscape(r.netsuiteExpenseReportId),
      String(r.items.length),
      total.toFixed(2),
    ].join(",");
  });

  const itemRows = reports.flatMap(r =>
    r.items.map(i => [
      csvEscape(r.id),
      String(i.lineNumber),
      csvEscape(i.category?.name),
      csvEscape(i.department?.name),
      csvEscape(i.vendorName),
      csvEscape(i.vendorNit),
      csvEscape(i.invoiceNumber),
      csvEscape(i.invoiceDate ? new Date(i.invoiceDate as Date).toLocaleDateString("es-CO") : ""),
      String(i.subtotal ?? 0),
      String(i.taxAmount ?? 0),
      String(i.retentionAmount ?? 0),
      String(i.total ?? 0),
      csvEscape(i.currency),
      csvEscape(PAYMENT_LABELS[i.paymentMethod] ?? i.paymentMethod),
      csvEscape(i.documentTypeDetected ?? ""),
      csvEscape(i.nsRecordId),
      csvEscape(i.syncError),
    ].join(","))
  );

  const date = new Date().toISOString().slice(0, 10);
  const csv = [
    "=== INFORMES ===",
    headerReport,
    ...reportRows,
    "",
    "=== LÍNEAS DE GASTO ===",
    headerItem,
    ...itemRows,
  ].join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="gastos-${date}.csv"`,
    },
  });
}
