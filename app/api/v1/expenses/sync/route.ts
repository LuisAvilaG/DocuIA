import { withApiSecurity } from "@/lib/security/http";
import { getErpExpenses } from "@/lib/erp";
import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { isFeatureEnabled } from "@/lib/features";

async function handlePOST(req: NextRequest) {
  const session = await getTenantSession({ area: "expenses", permission: "write" });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  if (!await isFeatureEnabled(session.orgId, "expense_management")) {
    return NextResponse.json({ error: "Módulo de gastos no activado" }, { status: 403 });
  }
  if (!await isFeatureEnabled(session.orgId, "expense_categories_sync")) {
    return NextResponse.json({ error: "La sincronización de catálogos de gastos no está activada" }, { status: 403 });
  }

  const body = await req.json() as {
    action: "sync_categories" | "sync_departments" | "sync_classes" | "sync_employees" | "sync_all";
    subsidiaryId?: string;
  };

  const erp = await getErpExpenses(session.orgId);
  if (!erp) {
    return NextResponse.json(
      { error: "No hay conexión activa con el ERP. Contacta al administrador de DocuIA." },
      { status: 422 },
    );
  }

  const subsidiaryId = body.subsidiaryId ?? null;

  try {
    const results: Record<string, unknown> = {};

    if (body.action === "sync_categories" || body.action === "sync_all") {
      results.categories = await erp.syncCategories(session.orgId, subsidiaryId);
    }
    if (body.action === "sync_departments" || body.action === "sync_all") {
      results.departments = await erp.syncDepartments(session.orgId, subsidiaryId);
    }
    if (body.action === "sync_classes" || body.action === "sync_all") {
      results.classes = await erp.syncClasses(session.orgId, subsidiaryId);
    }
    if (body.action === "sync_employees" || body.action === "sync_all") {
      results.employees = await erp.syncEmployees(session.orgId);
    }

    return NextResponse.json({ ok: true, results });
  } catch (err) {
    console.error("[v1/expenses/sync]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error durante la sincronización" },
      { status: 502 },
    );
  }
}

export const POST = withApiSecurity(handlePOST);
