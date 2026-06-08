import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { isFeatureEnabled } from "@/lib/features";
import { db } from "@/lib/db";
import { expenseCategories } from "@/db/schema";
import { and, eq } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  if (!await isFeatureEnabled(session.orgId, "expense_management")) {
    return NextResponse.json({ error: "Módulo de gastos no activado" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json() as { dailyCap?: number | null; monthlyCap?: number | null };

  const cat = await db.query.expenseCategories.findFirst({
    where: and(
      eq(expenseCategories.id, Number(id)),
      eq(expenseCategories.organizationId, session.orgId),
    ),
    columns: { id: true },
  });
  if (!cat) return NextResponse.json({ error: "Categoría no encontrada" }, { status: 404 });

  await db.update(expenseCategories)
    .set({
      dailyCap:   body.dailyCap   != null ? String(body.dailyCap)   : null,
      monthlyCap: body.monthlyCap != null ? String(body.monthlyCap) : null,
      updatedAt:  new Date(),
    })
    .where(eq(expenseCategories.id, Number(id)));

  return NextResponse.json({ ok: true });
}
