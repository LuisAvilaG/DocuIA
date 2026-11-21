import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { canApprove } from "@/lib/auth/permissions";
import { isFeatureEnabled } from "@/lib/features";
import { db } from "@/lib/db";
import { expenseItems, expenseReports } from "@/db/schema";
import { eq, and, inArray, isNotNull, isNull } from "drizzle-orm";
import { sendEmail, buildExpenseRejectedEmail } from "@/lib/email/send";
import { logAudit } from "@/lib/audit/log";

type Params = { params: Promise<{ id: string }> };

async function handlePOST(req: NextRequest, { params }: Params) {
  const session = await getTenantSession({ area: "expenses", permission: "write" });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!canApprove(session.role, "expenses")) return NextResponse.json({ error: "No tienes permiso para rechazar informes" }, { status: 403 });
  if (!await isFeatureEnabled(session.orgId, "expense_management")) {
    return NextResponse.json({ error: "Módulo de gastos no activado" }, { status: 403 });
  }

  const { id } = await params;

  const body = await req.json() as { reason?: string };
  if (!body.reason?.trim()) {
    return NextResponse.json({ error: "El motivo del rechazo es obligatorio" }, { status: 400 });
  }

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
  // An approved report that cannot be posted (or failed to) may go back to the
  // employee too, as long as nothing of it exists in NetSuite yet.
  const decided = report.status === "approved" || report.status === "exception";
  if (report.status !== "submitted" && report.status !== "under_review" && !decided) {
    return NextResponse.json({ error: `No se puede rechazar un informe en estado "${report.status}"` }, { status: 409 });
  }
  if (decided) {
    const posted = report.netsuiteExpenseReportId || await db.query.expenseItems.findFirst({
      where: and(eq(expenseItems.reportId, id), isNotNull(expenseItems.nsRecordId)),
      columns: { id: true },
    });
    if (posted) return NextResponse.json({ error: "Este informe ya tiene registros creados en el ERP y no se puede devolver al empleado." }, { status: 409 });
  }

  const rejected = await db.update(expenseReports)
    .set({ status: "rejected", rejectedReason: body.reason.trim(), syncError: null, updatedAt: new Date() })
    .where(and(
      eq(expenseReports.id, id),
      decided
        ? and(inArray(expenseReports.status, ["approved", "exception"]), isNull(expenseReports.netsuiteExpenseReportId))
        : inArray(expenseReports.status, ["submitted", "under_review"]),
    ))
    .returning({ id: expenseReports.id });
  if (!rejected.length) return NextResponse.json({ error: "El informe cambió de estado mientras lo procesabas. Recarga la página." }, { status: 409 });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  await sendEmail({
    to:      report.submitter.email,
    subject: "Tu informe de gastos fue rechazado",
    html:    buildExpenseRejectedEmail({
      submitterName: report.submitter.fullName ?? report.submitter.email,
      purpose:       report.purpose,
      reason:        body.reason.trim(),
      reportUrl:     `${appUrl}/expenses/${id}`,
    }),
  });

  await logAudit({
    orgId:        session.orgId,
    userId:       session.sub,
    userEmail:    session.email,
    action:       "expense.rejected",
    resourceType: "expense_report",
    resourceId:   id,
    metadata:     { purpose: report.purpose, reason: body.reason.trim() },
  });

  return NextResponse.json({ ok: true });
}

export const POST = withApiSecurity(handlePOST);
