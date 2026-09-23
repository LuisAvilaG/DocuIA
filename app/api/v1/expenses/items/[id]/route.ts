import { withApiSecurity } from "@/lib/security/http";
import { ownsExpenseCatalogReferences } from "@/lib/expense/catalog-access";
import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { isFeatureEnabled } from "@/lib/features";
import { db } from "@/lib/db";
import { expenseDocuments, expenseItems } from "@/db/schema";
import { eq } from "drizzle-orm";
import { validateExpenseAmounts } from "@/lib/expense/tax-engine";
import { deleteFile } from "@/lib/storage/minio";
import {
  expenseRecordType, firstIssue, needsDocumentoEquivalente, updateExpenseItemSchema, type ExpenseDocumentType,
} from "@/lib/expense/item-input";

type Params = { params: Promise<{ id: string }> };

async function loadEditableItem(id: string, session: { orgId: string; sub: string; role: string }, action: string) {
  const item = await db.query.expenseItems.findFirst({
    where: eq(expenseItems.id, id),
    with: { report: { columns: { organizationId: true, submitterId: true, status: true } } },
  });
  if (!item) return { error: NextResponse.json({ error: "Gasto no encontrado" }, { status: 404 }) };
  if (item.report.organizationId !== session.orgId) return { error: NextResponse.json({ error: "No autorizado" }, { status: 403 }) };
  if (session.role !== "admin" && item.report.submitterId !== session.sub) return { error: NextResponse.json({ error: "No autorizado" }, { status: 403 }) };
  if (item.report.status !== "draft") return { error: NextResponse.json({ error: `Solo se pueden ${action} gastos de informes en borrador` }, { status: 409 }) };
  return { item };
}

async function handleDELETE(_req: NextRequest, { params }: Params) {
  const session = await getTenantSession({ area: "expenses", permission: "write" });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!await isFeatureEnabled(session.orgId, "expense_management")) {
    return NextResponse.json({ error: "Módulo de gastos no activado" }, { status: 403 });
  }

  const { id } = await params;
  const { error } = await loadEditableItem(id, session, "eliminar");
  if (error) return error;

  // No foreign keys cascade here: remove the receipts with their line so no
  // orphaned rows or stored files are left behind.
  const documents = await db.transaction(async (tx) => {
    const removed = await tx.delete(expenseDocuments).where(eq(expenseDocuments.itemId, id)).returning({ fileKey: expenseDocuments.fileKey });
    await tx.delete(expenseItems).where(eq(expenseItems.id, id));
    return removed;
  });
  await Promise.allSettled(documents.filter((d) => d.fileKey).map((d) => deleteFile(d.fileKey!)));

  return NextResponse.json({ ok: true });
}

async function handlePATCH(req: NextRequest, { params }: Params) {
  const session = await getTenantSession({ area: "expenses", permission: "write" });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!await isFeatureEnabled(session.orgId, "expense_management")) {
    return NextResponse.json({ error: "Módulo de gastos no activado" }, { status: 403 });
  }

  const { id } = await params;
  const { item, error } = await loadEditableItem(id, session, "editar");
  if (error) return error;

  const parsed = updateExpenseItemSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
  const body = parsed.data;
  if (!await ownsExpenseCatalogReferences(session.orgId, body)) return NextResponse.json({ error: "Categoría, departamento o clase no válidos" }, { status: 400 });

  const { subtotal, taxAmount, retentionAmount, total, ...rest } = body;
  const updates: Partial<typeof expenseItems.$inferInsert> = { ...rest, updatedAt: new Date() };
  for (const key of Object.keys(updates) as Array<keyof typeof updates>) {
    if (updates[key] === undefined) delete updates[key];
  }

  // SECURITY: if any money field is being edited, re-validate the resulting
  // amounts (merge of stored + incoming) so the persisted total can never
  // diverge from its components.
  if ([subtotal, taxAmount, retentionAmount, total].some((v) => v !== undefined)) {
    const amounts = {
      subtotal:        subtotal        ?? Number(item.subtotal),
      taxAmount:       taxAmount       ?? Number(item.taxAmount),
      retentionAmount: retentionAmount ?? Number(item.retentionAmount),
      total:           total           ?? Number(item.total),
    };
    const amountCheck = validateExpenseAmounts(amounts);
    if (!amountCheck.ok) return NextResponse.json({ error: amountCheck.error }, { status: 400 });
    updates.subtotal = String(amounts.subtotal);
    updates.taxAmount = String(amounts.taxAmount);
    updates.retentionAmount = String(amounts.retentionAmount);
    updates.total = String(amounts.total);
  }

  // Payment method and document type decide the NetSuite record; keep it in sync.
  if (body.paymentMethod !== undefined || body.documentTypeDetected !== undefined || body.needsDocumentoEquivalente !== undefined) {
    const docType = (body.documentTypeDetected ?? item.documentTypeDetected ?? "unknown") as ExpenseDocumentType;
    const needsDE = body.needsDocumentoEquivalente ?? (body.documentTypeDetected !== undefined
      ? needsDocumentoEquivalente(docType)
      : item.needsDocumentoEquivalente);
    updates.needsDocumentoEquivalente = needsDE;
    updates.nsRecordType = expenseRecordType(body.paymentMethod ?? item.paymentMethod, docType, needsDE);
  }

  await db.update(expenseItems).set(updates).where(eq(expenseItems.id, id));

  return NextResponse.json({ ok: true });
}

export const DELETE = withApiSecurity(handleDELETE);
export const PATCH = withApiSecurity(handlePATCH);
