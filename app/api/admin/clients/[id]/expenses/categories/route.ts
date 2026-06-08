import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/admin";
import { db } from "@/lib/db";
import { expenseCategories } from "@/db/schema";
import { and, eq } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const { error } = await requireAdminSession();
  if (error) return error;

  const { id: organizationId } = await params;
  const url = new URL(req.url);
  const categoryId = Number(url.searchParams.get("categoryId"));

  if (!categoryId || isNaN(categoryId)) {
    return NextResponse.json({ error: "categoryId requerido" }, { status: 400 });
  }

  const body = await req.json() as { dailyCap?: string | null; monthlyCap?: string | null };

  const existing = await db.query.expenseCategories.findFirst({
    where: and(
      eq(expenseCategories.id, categoryId),
      eq(expenseCategories.organizationId, organizationId),
    ),
    columns: { id: true },
  });

  if (!existing) {
    return NextResponse.json({ error: "Categoría no encontrada" }, { status: 404 });
  }

  await db.update(expenseCategories)
    .set({
      dailyCap:   body.dailyCap   != null ? String(body.dailyCap)   : null,
      monthlyCap: body.monthlyCap != null ? String(body.monthlyCap) : null,
      updatedAt:  new Date(),
    })
    .where(eq(expenseCategories.id, categoryId));

  return NextResponse.json({ ok: true });
}
