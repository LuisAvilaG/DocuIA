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

  const body = await req.json().catch(() => null) as { purpose?: unknown; periodStart?: unknown; periodEnd?: unknown } | null;
  const purpose = typeof body?.purpose === "string" ? body.purpose.trim() : "";
  if (!purpose) {
    return NextResponse.json({ error: "El propósito del informe es requerido" }, { status: 400 });
  }
  if (purpose.length > 500) {
    return NextResponse.json({ error: "El propósito admite hasta 500 caracteres" }, { status: 400 });
  }
  // No date is fine; something that is not a date is not.
  const day = (value: unknown): Date | null | undefined => {
    if (value === undefined || value === null || value === "") return null;
    const parsed = typeof value === "string" ? new Date(value) : null;
    return parsed && !Number.isNaN(parsed.getTime()) ? parsed : undefined;
  };
  const periodStart = day(body?.periodStart), periodEnd = day(body?.periodEnd);
  if (periodStart === undefined || periodEnd === undefined) {
    return NextResponse.json({ error: "Las fechas del periodo no son válidas" }, { status: 400 });
  }
  if (periodStart && periodEnd && periodEnd < periodStart) {
    return NextResponse.json({ error: "El fin del periodo no puede ser anterior a su inicio" }, { status: 400 });
  }

  const id = randomUUID();
  await db.insert(expenseReports).values({
    id,
    organizationId: session.orgId,
    submitterId:    session.sub,
    purpose,
    periodStart,
    periodEnd,
    status:         "draft",
  });

  return NextResponse.json({ ok: true, reportId: id }, { status: 201 });
}

export const GET = withApiSecurity(handleGET);
export const POST = withApiSecurity(handlePOST);
