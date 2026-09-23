import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { canApprove } from "@/lib/auth/permissions";
import { isFeatureEnabled } from "@/lib/features";
import { db } from "@/lib/db";
import { expenseReports, expenseItems, orgUsers } from "@/db/schema";
import { eq, and, inArray, sum } from "drizzle-orm";
import { sendEmail, buildExpenseApprovedEmail } from "@/lib/email/send";
import { logAudit } from "@/lib/audit/log";

type Params = { params: Promise<{ id: string }> };

async function handlePOST(req: NextRequest, { params }: Params) {
  const session = await getTenantSession({ area: "expenses", permission: "write" });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!canApprove(session.role, "expenses")) return NextResponse.json({ error: "No tienes permiso para aprobar informes" }, { status: 403 });
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
  if (report.status !== "submitted" && report.status !== "under_review") {
    return NextResponse.json({ error: `No se puede aprobar un informe en estado "${report.status}"` }, { status: 409 });
  }
  // Only administrators may approve their own reports.
  if (report.submitterId === session.sub && session.role !== "admin") {
    return NextResponse.json({ error: "No puedes aprobar tu propio informe" }, { status: 403 });
  }

  const approved = await db.update(expenseReports)
    .set({ status: "approved", approvedAt: new Date(), approvedBy: session.sub, updatedAt: new Date() })
    .where(and(eq(expenseReports.id, id), inArray(expenseReports.status, ["submitted", "under_review"])))
    .returning({ id: expenseReports.id });
  if (!approved.length) return NextResponse.json({ error: "El informe cambió de estado mientras lo procesabas. Recarga la página." }, { status: 409 });

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

export const POST = withApiSecurity(handlePOST);
