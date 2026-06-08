import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { isFeatureEnabled } from "@/lib/features";
import { syncReportToNetsuite } from "@/lib/expense/sync-to-netsuite";
import { logAudit } from "@/lib/audit/log";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Solo administradores pueden sincronizar informes" }, { status: 403 });
  if (!await isFeatureEnabled(session.orgId, "expense_management")) {
    return NextResponse.json({ error: "Módulo de gastos no activado" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const result = await syncReportToNetsuite(id, session.orgId);

    await logAudit({
      orgId:        session.orgId,
      userId:       session.sub,
      userEmail:    session.email,
      action:       result.ok ? "expense.synced" : "expense.sync_failed",
      resourceType: "expense_report",
      resourceId:   id,
      metadata:     {
        nsExpenseReportId: result.nsExpenseReportId,
        errors:            result.errors.length > 0 ? result.errors : undefined,
      },
    });

    const status = result.ok ? 200 : 207;
    return NextResponse.json(result, { status });
  } catch (err) {
    console.error("[expenses/sync POST]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error interno durante la sincronización" },
      { status: 500 },
    );
  }
}
