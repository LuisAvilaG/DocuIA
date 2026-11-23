import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { isFeatureEnabled } from "@/lib/features";
import { db } from "@/lib/db";
import { expenseCategories } from "@/db/schema";
import { and, eq } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

async function handlePATCH(req: NextRequest, { params }: Params) {
  const session = await getTenantSession({ area: "expenses", permission: "write" });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  if (!await isFeatureEnabled(session.orgId, "expense_management")) {
    return NextResponse.json({ error: "Módulo de gastos no activado" }, { status: 403 });
  }

  const { id } = await params;
  const categoryId = Number(id);
  if (!Number.isSafeInteger(categoryId) || categoryId <= 0) return NextResponse.json({ error: "Categoría no encontrada" }, { status: 404 });
  const body = (await req.json().catch(() => null) ?? {}) as { dailyCap?: unknown; monthlyCap?: unknown };

  const cat = await db.query.expenseCategories.findFirst({
    where: and(
      eq(expenseCategories.id, categoryId),
      eq(expenseCategories.organizationId, session.orgId),
    ),
    columns: { id: true },
  });
  if (!cat) return NextResponse.json({ error: "Categoría no encontrada" }, { status: 404 });

  // Empty clears the cap. Otherwise a non-negative amount that fits the column.
  const cap = (value: unknown): string | null | undefined => {
    if (value === undefined || value === null || value === "") return null;
    const n = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
    return Number.isFinite(n) && n >= 0 && n < 1e10 ? String(Math.round(n * 100) / 100) : undefined;
  };
  const dailyCap = cap(body.dailyCap), monthlyCap = cap(body.monthlyCap);
  if (dailyCap === undefined || monthlyCap === undefined) {
    return NextResponse.json({ error: "Los topes deben ser números no negativos" }, { status: 400 });
  }

  await db.update(expenseCategories)
    .set({ dailyCap, monthlyCap, updatedAt: new Date() })
    .where(eq(expenseCategories.id, categoryId));

  return NextResponse.json({ ok: true });
}

export const PATCH = withApiSecurity(handlePATCH);
