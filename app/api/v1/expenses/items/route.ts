import { withApiSecurity } from "@/lib/security/http";
import { verifyUploadReceipt } from "@/lib/security/upload-receipt";
import { ownsExpenseCatalogReferences } from "@/lib/expense/catalog-access";
import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { isFeatureEnabled } from "@/lib/features";
import { db } from "@/lib/db";
import { expenseReports, expenseItems, expenseDocuments } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";
import { validateExpenseAmounts } from "@/lib/expense/tax-engine";
import {
  createExpenseItemSchema, expenseRecordType, firstIssue, needsDocumentoEquivalente, resolveAmounts,
} from "@/lib/expense/item-input";

async function handlePOST(req: NextRequest) {
  const session = await getTenantSession({ area: "expenses", permission: "write" });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!await isFeatureEnabled(session.orgId, "expense_management")) {
    return NextResponse.json({ error: "Módulo de gastos no activado" }, { status: 403 });
  }

  try {
    const parsed = createExpenseItemSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    const body = parsed.data;

    if (!await ownsExpenseCatalogReferences(session.orgId, body)) return NextResponse.json({ error: "Categoría, departamento o clase no válidos" }, { status: 400 });
    const receipt = body.fileKey ? verifyUploadReceipt(body.uploadReceipt, session.orgId, session.sub, body.fileKey) : null;
    if (body.fileKey && !receipt) return NextResponse.json({ error: "El archivo no corresponde a una carga tuya válida. Vuelve a cargarlo." }, { status: 400 });

    // SECURITY: never trust client-computed money. Enforce arithmetic + bounds.
    const amounts = resolveAmounts({ ...body, total: body.total });
    const amountCheck = validateExpenseAmounts(amounts);
    if (!amountCheck.ok) return NextResponse.json({ error: amountCheck.error }, { status: 400 });

    // Verify report belongs to org and is in draft
    const report = await db.query.expenseReports.findFirst({
      where: and(
        eq(expenseReports.id, body.reportId),
        eq(expenseReports.organizationId, session.orgId),
      ),
      with: { items: { columns: { lineNumber: true } } },
    });

    if (!report) return NextResponse.json({ error: "Informe no encontrado" }, { status: 404 });
    if (report.status !== "draft") return NextResponse.json({ error: "Solo se pueden agregar gastos a informes en borrador" }, { status: 409 });
    if (session.role !== "admin" && report.submitterId !== session.sub) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const nextLine = (report.items.reduce((max, i) => Math.max(max, i.lineNumber), 0)) + 1;
    const docType = body.documentTypeDetected ?? "unknown";
    const needsDE = needsDocumentoEquivalente(docType, body.needsDocumentoEquivalente);
    const itemId = randomUUID();

    await db.insert(expenseItems).values({
      id:                       itemId,
      reportId:                 body.reportId,
      lineNumber:               nextLine,
      categoryId:               body.categoryId ?? null,
      departmentId:             body.departmentId ?? null,
      classId:                  body.classId ?? null,
      expenseDate:              body.expenseDate ?? null,
      description:              body.description ?? null,
      vendorName:               body.vendorName ?? null,
      vendorNit:                body.vendorNit ?? null,
      invoiceNumber:            body.invoiceNumber ?? null,
      invoiceDate:              body.invoiceDate ?? null,
      subtotal:                 String(amounts.subtotal),
      taxAmount:                String(amounts.taxAmount),
      retentionAmount:          String(amounts.retentionAmount),
      total:                    String(amounts.total),
      currency:                 body.currency ?? "COP",
      paymentMethod:            body.paymentMethod,
      documentTypeDetected:     docType,
      needsDocumentoEquivalente: needsDE,
      nsRecordType:             expenseRecordType(body.paymentMethod, docType, needsDE),
    });

    if (body.fileKey) {
      await db.insert(expenseDocuments).values({
        itemId:               itemId,
        fileKey:              body.fileKey,
        mimeType:             receipt!.mimeType,
        originalName:         receipt!.originalName,
        documentTypeDetected: docType,
      });
    }

    return NextResponse.json({ ok: true, itemId }, { status: 201 });
  } catch (err) {
    console.error("[expenses/items POST]", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

export const POST = withApiSecurity(handlePOST);
