import { withApiSecurity } from "@/lib/security/http";
import { canReviewExpenses } from "@/lib/auth/permissions";
import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { isFeatureEnabled } from "@/lib/features";
import { db } from "@/lib/db";
import { expenseReports } from "@/db/schema";
import { eq, desc, and, notInArray } from "drizzle-orm";
import { randomUUID } from "crypto";

async function handleGET(req: NextRequest) {
  const session = await getTenantSession({ area: "expenses" });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!await isFeatureEnabled(session.orgId, "expense_management")) {
    return NextResponse.json({ error: "Módulo de gastos no activado" }, { status: 403 });
  }

  const view = new URL(req.url).searchParams.get("view");

  // Accounting view: all org reports except drafts
  if (view === "accounting" && canReviewExpenses(session.role)) {
    const reports = await db.query.expenseReports.findMany({
      where: and(
        eq(expenseReports.organizationId, session.orgId),
        notInArray(expenseReports.status, ["draft"]),
      ),
      with: {
        submitter: { columns: { fullName: true, email: true } },
        items: { columns: { id: true, total: true } },
      },
      orderBy: desc(expenseReports.createdAt),
    });
    return NextResponse.json({ reports });
  }

  // Default: the person's own reports
  const reports = await db.query.expenseReports.findMany({
    where: and(eq(expenseReports.submitterId, session.sub), eq(expenseReports.organizationId, session.orgId)),
    with: { items: { columns: { id: true, total: true } } },
    orderBy: desc(expenseReports.createdAt),
  });

  return NextResponse.json({ reports });
}

async function handlePOST(req: NextRequest) {
  const session = await getTenantSession({ area: "expenses", permission: "write" });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!await isFeatureEnabled(session.orgId, "expense_management")) {
    return NextResponse.json({ error: "Módulo de gastos no activado" }, { status: 403 });
  }

  const { purpose, periodStart, periodEnd } = await req.json() as {
    purpose:     string;
    periodStart?: string;
    periodEnd?:   string;
  };

  if (!purpose?.trim()) {
    return NextResponse.json({ error: "El propósito del informe es requerido" }, { status: 400 });
  }

  const id = randomUUID();
  await db.insert(expenseReports).values({
    id,
    organizationId: session.orgId,
    submitterId:    session.sub,
    purpose:        purpose.trim(),
    periodStart:    periodStart ? new Date(periodStart) : null,
    periodEnd:      periodEnd   ? new Date(periodEnd)   : null,
    status:         "draft",
  });

  return NextResponse.json({ ok: true, reportId: id }, { status: 201 });
}

export const GET = withApiSecurity(handleGET);
export const POST = withApiSecurity(handlePOST);
