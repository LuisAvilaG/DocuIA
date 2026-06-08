import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { isFeatureEnabled } from "@/lib/features";
import { db } from "@/lib/db";
import { expenseReports } from "@/db/schema";
import { eq, and } from "drizzle-orm";

export async function GET(
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
      submitter: { columns: { fullName: true, email: true } },
      items: {
        with: {
          category:   { columns: { id: true, name: true, netsuiteCategoryId: true } },
          department: { columns: { id: true, name: true } },
          class:      { columns: { id: true, name: true } },
          documents:  { columns: { id: true, mimeType: true, originalName: true, ocrConfidence: true } },
        },
        orderBy: (items, { asc }) => [asc(items.lineNumber)],
      },
    },
  });

  if (!report) return NextResponse.json({ error: "Informe no encontrado" }, { status: 404 });

  // Non-admins can only see their own reports
  if (session.role !== "admin" && report.submitterId !== session.sub) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  return NextResponse.json({ report });
}
