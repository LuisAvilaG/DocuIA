import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { isFeatureEnabled } from "@/lib/features";
import { db } from "@/lib/db";
import { expenseReports, expenseItems, orgUsers } from "@/db/schema";
import { eq, and, sum } from "drizzle-orm";
import { sendEmail, buildExpenseSubmittedEmail } from "@/lib/email/send";
import { syncReportToNetsuite } from "@/lib/expense/sync-to-netsuite";
import { logAudit } from "@/lib/audit/log";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
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
      items:     { columns: { id: true, total: true } },
      submitter: { columns: { fullName: true, email: true } },
    },
  });

  if (!report) return NextResponse.json({ error: "Informe no encontrado" }, { status: 404 });
  if (report.submitterId !== session.sub) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  if (report.status !== "draft") return NextResponse.json({ error: `El informe está en estado "${report.status}" y no puede enviarse` }, { status: 409 });
  if (!report.items.length) return NextResponse.json({ error: "El informe debe tener al menos un gasto antes de enviarse" }, { status: 400 });

  const approvalEnabled = await isFeatureEnabled(session.orgId, "expense_approval");

  if (!approvalEnabled) {
    // Sin aprobación requerida: auto-aprobar y sincronizar directamente
    await db.update(expenseReports)
      .set({ status: "approved", submittedAt: new Date(), approvedAt: new Date(), updatedAt: new Date() })
      .where(eq(expenseReports.id, id));

    await logAudit({
      orgId:        session.orgId,
      userId:       session.sub,
      userEmail:    session.email,
      action:       "expense.submitted_auto_sync",
      resourceType: "expense_report",
      resourceId:   id,
      metadata:     { purpose: report.purpose },
    });

    const syncResult = await syncReportToNetsuite(id, session.orgId);
    return NextResponse.json({ ok: true, autoSynced: true, syncResult });
  }

  // Con aprobación: pasar a submitted y notificar admins
  await db.update(expenseReports)
    .set({ status: "submitted", submittedAt: new Date(), updatedAt: new Date() })
    .where(eq(expenseReports.id, id));

  await logAudit({
    orgId:        session.orgId,
    userId:       session.sub,
    userEmail:    session.email,
    action:       "expense.submitted",
    resourceType: "expense_report",
    resourceId:   id,
    metadata:     { purpose: report.purpose },
  });

  const admins = await db.query.orgUsers.findMany({
    where: and(eq(orgUsers.organizationId, session.orgId), eq(orgUsers.role, "admin")),
    columns: { email: true },
  });

  if (admins.length > 0) {
    const totalRow = await db
      .select({ total: sum(expenseItems.total) })
      .from(expenseItems)
      .where(eq(expenseItems.reportId, id));

    const totalFormatted = totalRow[0]?.total
      ? `$${Number(totalRow[0].total).toLocaleString("es-CO", { maximumFractionDigits: 0 })}`
      : "—";

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const html = buildExpenseSubmittedEmail({
      submitterName: report.submitter.fullName ?? report.submitter.email,
      purpose:       report.purpose,
      totalAmount:   totalFormatted,
      reportUrl:     `${appUrl}/accounting/expenses/${id}`,
    });

    await Promise.allSettled(admins.map(a =>
      sendEmail({ to: a.email, subject: "Informe de gastos pendiente de revisión", html })
    ));
  }

  return NextResponse.json({ ok: true });
}
