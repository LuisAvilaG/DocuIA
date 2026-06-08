import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { isFeatureEnabled } from "@/lib/features";
import { db } from "@/lib/db";
import { expenseItems, expenseReports } from "@/db/schema";
import { eq, and } from "drizzle-orm";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!await isFeatureEnabled(session.orgId, "expense_management")) {
    return NextResponse.json({ error: "Módulo de gastos no activado" }, { status: 403 });
  }

  const { id } = await params;

  const item = await db.query.expenseItems.findFirst({
    where: eq(expenseItems.id, id),
    with: { report: { columns: { organizationId: true, submitterId: true, status: true } } },
  });

  if (!item) return NextResponse.json({ error: "Gasto no encontrado" }, { status: 404 });
  if (item.report.organizationId !== session.orgId) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  if (session.role !== "admin" && item.report.submitterId !== session.sub) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  if (item.report.status !== "draft") return NextResponse.json({ error: "Solo se pueden eliminar gastos de informes en borrador" }, { status: 409 });

  await db.delete(expenseItems).where(eq(expenseItems.id, id));

  return NextResponse.json({ ok: true });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!await isFeatureEnabled(session.orgId, "expense_management")) {
    return NextResponse.json({ error: "Módulo de gastos no activado" }, { status: 403 });
  }

  const { id } = await params;

  const item = await db.query.expenseItems.findFirst({
    where: eq(expenseItems.id, id),
    with: { report: { columns: { organizationId: true, submitterId: true, status: true } } },
  });

  if (!item) return NextResponse.json({ error: "Gasto no encontrado" }, { status: 404 });
  if (item.report.organizationId !== session.orgId) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  if (session.role !== "admin" && item.report.submitterId !== session.sub) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  if (item.report.status !== "draft") return NextResponse.json({ error: "Solo se pueden editar gastos de informes en borrador" }, { status: 409 });

  const body = await req.json() as Record<string, unknown>;
  const allowed = ["categoryId","departmentId","classId","expenseDate","description","vendorName","vendorNit","invoiceNumber","invoiceDate","subtotal","taxAmount","retentionAmount","total","currency","paymentMethod","documentTypeDetected","needsDocumentoEquivalente"];
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  for (const key of allowed) {
    if (key in body) updates[key] = body[key];
  }

  await db.update(expenseItems).set(updates as any).where(eq(expenseItems.id, id));

  return NextResponse.json({ ok: true });
}
