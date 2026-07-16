import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { isFeatureEnabled } from "@/lib/features";
import { db } from "@/lib/db";
import { expenseItems } from "@/db/schema";
import { eq } from "drizzle-orm";
import { validateExpenseAmounts } from "@/lib/expense/tax-engine";

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

  // SECURITY: if any money field is being edited, re-validate the resulting
  // amounts (merge of stored + incoming) so the persisted total can never
  // diverge from its components.
  const moneyFields = ["subtotal", "taxAmount", "retentionAmount", "total"] as const;
  if (moneyFields.some(f => f in body)) {
    const amounts = {
      subtotal:        "subtotal"        in body ? Number(body.subtotal)        : Number(item.subtotal),
      taxAmount:       "taxAmount"       in body ? Number(body.taxAmount)       : Number(item.taxAmount),
      retentionAmount: "retentionAmount" in body ? Number(body.retentionAmount) : Number(item.retentionAmount),
      total:           "total"           in body ? Number(body.total)           : Number(item.total),
    };
    const amountCheck = validateExpenseAmounts(amounts);
    if (!amountCheck.ok) return NextResponse.json({ error: amountCheck.error }, { status: 400 });
    // Persist coerced numeric strings, never raw client values.
    for (const f of moneyFields) {
      if (f in body) updates[f] = String(amounts[f]);
    }
  }

  await db.update(expenseItems).set(updates as any).where(eq(expenseItems.id, id));

  return NextResponse.json({ ok: true });
}
