import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { isFeatureEnabled } from "@/lib/features";
import { db } from "@/lib/db";
import { expenseReports, expenseItems, orgUsers } from "@/db/schema";
import { eq, and, sum } from "drizzle-orm";
import { sendEmail, buildExpenseApprovedEmail } from "@/lib/email/send";
import { logAudit } from "@/lib/audit/log";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Solo administradores pueden aprobar informes" }, { status: 403 });
  if (!await isFeatureEnabled(session.orgId, "expense_management")) {
    return NextResponse.json({ error: "Módulo de gastos no activado" }, { status: 403 });
  }

  const { id } = await params;

  const report = await db.query.expenseReports.findFirst({
    where: and(
      eq(expenseReports.id, id),
      eq(expenseReports.organizationId, session.orgId),
    ),
    with: {
      submitter: { columns: { email: true, fullName: true } },
    },
  });

  if (!report) return NextResponse.json({ error: "Informe no encontrado" }, { status: 404 });
  if (report.status !== "submitted") {
    return NextResponse.json({ error: `No se puede aprobar un informe en estado "${report.status}"` }, { status: 409 });
  }

  await db.update(expenseReports)
    .set({ status: "approved", approvedAt: new Date(), approvedBy: session.sub, updatedAt: new Date() })
    .where(eq(expenseReports.id, id));

  // Calculate total for email
  const [totalRow] = await db
    .select({ total: sum(expenseItems.total) })
    .from(expenseItems)
    .where(eq(expenseItems.reportId, id));

  const totalFormatted = totalRow?.total
    ? `$${Number(totalRow.total).toLocaleString("es-CO", { maximumFractionDigits: 0 })}`
    : "—";

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  await sendEmail({
    to:      report.submitter.email,
    subject: "Tu informe de gastos fue aprobado",
    html:    buildExpenseApprovedEmail({
      submitterName: report.submitter.fullName ?? report.submitter.email,
      purpose:       report.purpose,
      totalAmount:   totalFormatted,
      reportUrl:     `${appUrl}/expenses/${id}`,
    }),
  });

  await logAudit({
    orgId:        session.orgId,
    userId:       session.sub,
    userEmail:    session.email,
    action:       "expense.approved",
    resourceType: "expense_report",
    resourceId:   id,
    metadata:     { purpose: report.purpose, submitterEmail: report.submitter.email },
  });

  return NextResponse.json({ ok: true });
}
