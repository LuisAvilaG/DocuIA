import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { isFeatureEnabled } from "@/lib/features";
import { db } from "@/lib/db";
import { expenseReports, expenseItems, orgUsers } from "@/db/schema";
import { eq, and, inArray, ne } from "drizzle-orm";
import { formatExpenseTotals } from "@/lib/expense/totals";
import { sendEmail, buildExpenseSubmittedEmail } from "@/lib/email/send";
import { postExpenseReport } from "@/lib/erp";
import { expenseItemProblems } from "@/lib/expense/sync-precheck";
import { logAudit } from "@/lib/audit/log";

async function handlePOST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getTenantSession({ area: "expenses", permission: "write" });
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
      items:     {
        columns: { id: true, total: true, lineNumber: true, nsRecordType: true, currency: true, vendorNit: true, invoiceNumber: true, needsDocumentoEquivalente: true, invoiceDate: true, expenseDate: true },
        with: { category: { columns: { netsuiteCategoryId: true, netsuiteAccountId: true } } },
      },
      submitter: { columns: { fullName: true, email: true } },
    },
  });

  if (!report) return NextResponse.json({ error: "Informe no encontrado" }, { status: 404 });
  if (report.submitterId !== session.sub) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  if (report.status !== "draft") return NextResponse.json({ error: `El informe está en estado "${report.status}" y no puede enviarse` }, { status: 409 });
  if (!report.items.length) return NextResponse.json({ error: "El informe debe tener al menos un gasto antes de enviarse" }, { status: 400 });
  // Checked now, while the lines can still be edited: once approved, a report
  // whose lines cannot be posted to NetSuite had no way back.
  const problems = expenseItemProblems(report.items);
  if (problems.length) {
    return NextResponse.json({ error: `Corrige estos gastos antes de enviar el informe: ${problems.join("; ")}` }, { status: 400 });
  }

  const approvalEnabled = await isFeatureEnabled(session.orgId, "expense_approval");

  if (!approvalEnabled) {
    // Sin aprobación requerida: auto-aprobar y sincronizar directamente.
    // The status guard makes a double click submit (and sync) only once.
    const claimed = await db.update(expenseReports)
      .set({ status: "approved", submittedAt: new Date(), approvedAt: new Date(), rejectedReason: null, updatedAt: new Date() })
      .where(and(eq(expenseReports.id, id), eq(expenseReports.status, "draft")))
      .returning({ id: expenseReports.id });
    if (!claimed.length) return NextResponse.json({ error: "El informe cambió de estado mientras lo procesabas. Recarga la página." }, { status: 409 });

    await logAudit({
      orgId:        session.orgId,
      userId:       session.sub,
      userEmail:    session.email,
      action:       "expense.submitted_auto_sync",
      resourceType: "expense_report",
      resourceId:   id,
      metadata:     { purpose: report.purpose },
    });

    // The report is approved at this point; a sync failure (e.g. NetSuite not
    // configured) is reported to accounting, not as a failed submission.
    try {
      const syncResult = await postExpenseReport(id, session.orgId);
      // Sent either way; "autoSynced" only when NetSuite actually took it.
      return NextResponse.json({ ok: true, autoSynced: syncResult.ok, syncResult });
    } catch (err) {
      console.error("[expenses/submit] auto-sync failed", err);
      return NextResponse.json({ ok: true, autoSynced: false, syncError: "El informe fue aprobado, pero no se pudo sincronizar con el ERP. Contabilidad lo revisará." });
    }
  }

  // Con aprobación: pasar a submitted y notificar admins
  const submitted = await db.update(expenseReports)
    .set({ status: "submitted", submittedAt: new Date(), rejectedReason: null, updatedAt: new Date() })
    .where(and(eq(expenseReports.id, id), eq(expenseReports.status, "draft")))
    .returning({ id: expenseReports.id });
  if (!submitted.length) return NextResponse.json({ error: "El informe cambió de estado mientras lo procesabas. Recarga la página." }, { status: 409 });

  await logAudit({
    orgId:        session.orgId,
    userId:       session.sub,
    userEmail:    session.email,
    action:       "expense.submitted",
    resourceType: "expense_report",
    resourceId:   id,
    metadata:     { purpose: report.purpose },
  });

  // Everyone who can approve expenses, except the submitter.
  const admins = await db.query.orgUsers.findMany({
    where: and(
      eq(orgUsers.organizationId, session.orgId),
      inArray(orgUsers.role, ["admin", "approver", "accountant"]),
      eq(orgUsers.isActive, true),
      ne(orgUsers.id, session.sub),
    ),
    columns: { email: true },
  });

  if (admins.length > 0) {
    // One figure per currency, never a mixed sum.
    const totalItems = await db
      .select({ total: expenseItems.total, currency: expenseItems.currency })
      .from(expenseItems)
      .where(eq(expenseItems.reportId, id));

    const totalFormatted = totalItems.length ? formatExpenseTotals(totalItems) : "—";

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
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

export const POST = withApiSecurity(handlePOST);
