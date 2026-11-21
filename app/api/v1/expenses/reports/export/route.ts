import { withApiSecurity } from "@/lib/security/http";
import { canSyncExpenses } from "@/lib/auth/permissions";
import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { isFeatureEnabled } from "@/lib/features";
import { db } from "@/lib/db";
import { expenseReports, expenseItems } from "@/db/schema";
import { eq, and, desc, ne } from "drizzle-orm";
import { orgTimeZone } from "@/lib/org-time-zone";

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
  let s = String(v ?? "");
  // Neutralize CSV formula injection (Excel/Sheets execute cells starting = + - @).
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

async function handleGET(req: NextRequest) {
  const session = await getTenantSession({ area: "expenses" });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!canSyncExpenses(session.role)) return NextResponse.json({ error: "No tienes permiso para exportar informes" }, { status: 403 });
  if (!await isFeatureEnabled(session.orgId, "expense_management")) {
    return NextResponse.json({ error: "Módulo de gastos no activado" }, { status: 403 });
  }

  const reports = await db.query.expenseReports.findMany({
    // A draft is still the employee's own: accounting does not see it on screen either.
    where: and(eq(expenseReports.organizationId, session.orgId), ne(expenseReports.status, "draft")),
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

  const headerReport = ["ID Informe", "Propósito", "Empleado", "Email", "Período inicio", "Período fin", "Estado", "Enviado el", "Aprobado el", "ID ERP", "# Líneas", "Total Informe", "Moneda"].join(",");
  const timeZone = await orgTimeZone(session.orgId);
  // Dates without a time are stored at midnight UTC; moments are shown in the client's zone.
  const dateOnly = (value: Date | string | null) => (value ? new Date(value).toLocaleDateString("es-CO", { timeZone: "UTC" }) : "");
  const moment = (value: Date | string | null) => (value ? new Date(value).toLocaleDateString("es-CO", { timeZone }) : "");
  const headerItem = ["ID Informe", "# Línea", "Categoría", "Departamento", "Proveedor", "NIT/RFC", "# Factura", "Fecha factura", "Subtotal", "Impuesto", "Retención", "Total", "Moneda", "Forma pago", "Tipo documento", "ID registro ERP", "Error sync"].join(",");

  const reportRows = reports.map(r => {
    // One figure only when the report has one currency: adding pesos and
    // dollars gave a number that meant nothing.
    const byCurrency = new Map<string, number>();
    for (const i of r.items) byCurrency.set((i.currency ?? "").toUpperCase(), (byCurrency.get((i.currency ?? "").toUpperCase()) ?? 0) + Number(i.total ?? 0));
    const totals = [...byCurrency.entries()];
    const total = totals.length <= 1 ? (totals[0]?.[1] ?? 0).toFixed(2) : totals.map(([code, sum]) => `${sum.toFixed(2)} ${code || "sin moneda"}`).join(" + ");
    const currency = totals.length === 0 ? "" : totals.length === 1 ? totals[0][0] : "Varias";
    return [
      csvEscape(r.id),
      csvEscape(r.purpose),
      csvEscape(r.submitter?.fullName),
      csvEscape(r.submitter?.email),
      csvEscape(dateOnly(r.periodStart)),
      csvEscape(dateOnly(r.periodEnd)),
      csvEscape(STATUS_LABELS[r.status] ?? r.status),
      csvEscape(moment(r.submittedAt)),
      csvEscape(moment(r.approvedAt)),
      csvEscape(r.netsuiteExpenseReportId),
      String(r.items.length),
      csvEscape(total),
      csvEscape(currency),
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
      csvEscape(dateOnly(i.invoiceDate as Date | null)),
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

  // With the UTF-8 mark Excel on Windows reads the accents ("Propósito") right.
  return new NextResponse("\uFEFF" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="gastos-${date}.csv"`,
    },
  });
}

export const GET = withApiSecurity(handleGET);
