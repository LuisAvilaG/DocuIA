import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getTenantSession } from "@/lib/auth/jwt";
import { isFeatureEnabled } from "@/lib/features";
import { db } from "@/lib/db";
import { expenseReports } from "@/db/schema";
import { logAudit } from "@/lib/audit/log";

// A rejected report goes back to draft so its submitter can fix the lines and
// send it again; the rejection reason stays visible until the next submission.
async function handlePOST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getTenantSession({ area: "expenses", permission: "write" });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!await isFeatureEnabled(session.orgId, "expense_management")) {
    return NextResponse.json({ error: "Módulo de gastos no activado" }, { status: 403 });
  }

  const { id } = await params;
  const report = await db.query.expenseReports.findFirst({
    where: and(eq(expenseReports.id, id), eq(expenseReports.organizationId, session.orgId)),
    columns: { submitterId: true, status: true, purpose: true },
  });
  if (!report) return NextResponse.json({ error: "Informe no encontrado" }, { status: 404 });
  if (report.submitterId !== session.sub && session.role !== "admin") {
    return NextResponse.json({ error: "Solo quien creó el informe puede reabrirlo" }, { status: 403 });
  }

  const reopened = await db.update(expenseReports)
    .set({ status: "draft", updatedAt: new Date() })
    .where(and(eq(expenseReports.id, id), eq(expenseReports.status, "rejected")))
    .returning({ id: expenseReports.id });
  if (!reopened.length) return NextResponse.json({ error: "Solo se pueden reabrir informes rechazados" }, { status: 409 });

  await logAudit({
    orgId: session.orgId, userId: session.sub, userEmail: session.email,
    action: "expense.reopened", resourceType: "expense_report", resourceId: id,
    metadata: { purpose: report.purpose },
  });
  return NextResponse.json({ ok: true, status: "draft" });
}

export const POST = withApiSecurity(handlePOST);
