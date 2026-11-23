import { withApiSecurity } from "@/lib/security/http";
import { logAdminAction } from "@/lib/audit/admin";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/admin";
import { db } from "@/lib/db";
import { expenseCategories } from "@/db/schema";
import { and, eq } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

async function handlePATCH(req: NextRequest, { params }: Params) {
  const { error, session } = await requireAdminSession();
  if (error) return error;

  const { id: organizationId } = await params;
  const url = new URL(req.url);
  const categoryId = Number(url.searchParams.get("categoryId"));

  if (!categoryId || isNaN(categoryId)) {
    return NextResponse.json({ error: "categoryId requerido" }, { status: 400 });
  }

  const body = (await req.json().catch(() => null) ?? {}) as { dailyCap?: unknown; monthlyCap?: unknown };

  const existing = await db.query.expenseCategories.findFirst({
    where: and(
      eq(expenseCategories.id, categoryId),
      eq(expenseCategories.organizationId, organizationId),
    ),
    columns: { id: true, name: true, dailyCap: true, monthlyCap: true },
  });

  if (!existing) {
    return NextResponse.json({ error: "Categoría no encontrada" }, { status: 404 });
  }

  // A cap that is not in the body keeps its value; null clears it. Amounts
  // must be non-negative numbers that fit the column.
  const cap = (value: unknown, stored: string | null): string | null | undefined => {
    if (value === undefined) return stored;
    if (value === null || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 && n < 1e10 ? String(Math.round(n * 100) / 100) : undefined;
  };
  const dailyCap = cap(body.dailyCap, existing.dailyCap);
  const monthlyCap = cap(body.monthlyCap, existing.monthlyCap);
  if (dailyCap === undefined || monthlyCap === undefined) {
    return NextResponse.json({ error: "Los topes deben ser números no negativos" }, { status: 400 });
  }
  await db.update(expenseCategories)
    .set({ dailyCap, monthlyCap, updatedAt: new Date() })
    .where(eq(expenseCategories.id, categoryId));

  await logAdminAction(req, session!, {
    action: "expense_category.caps_updated", targetOrgId: organizationId,
    before: { dailyCap: existing.dailyCap, monthlyCap: existing.monthlyCap },
    after: { category: existing.name, dailyCap, monthlyCap },
  });
  return NextResponse.json({ ok: true });
}

export const PATCH = withApiSecurity(handlePATCH);
