import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { isFeatureEnabled } from "@/lib/features";
import { db } from "@/lib/db";
import { expenseReports, expenseItems, expenseDocuments, expenseCategories } from "@/db/schema";
import { eq, and, sum, count } from "drizzle-orm";
import { randomUUID } from "crypto";
import { calculateTaxes } from "@/lib/expense/tax-engine";

export async function POST(req: NextRequest) {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!await isFeatureEnabled(session.orgId, "expense_management")) {
    return NextResponse.json({ error: "Módulo de gastos no activado" }, { status: 403 });
  }

  try {
    const body = await req.json() as {
      reportId:                 string;
      categoryId?:              number;
      departmentId?:            number;
      classId?:                 number;
      expenseDate?:             string;
      description?:             string;
      vendorName?:              string;
      vendorNit?:               string;
      invoiceNumber?:           string;
      invoiceDate?:             string;
      subtotal:                 number;
      taxAmount?:               number;
      retentionAmount?:         number;
      total:                    number;
      currency?:                string;
      paymentMethod:            "personal" | "company_pays_vendor";
      documentTypeDetected?:    string;
      needsDocumentoEquivalente?: boolean;
      fileKey?:                 string;
      mimeType?:                string;
      originalName?:            string;
      ocrRaw?:                  Record<string, unknown>;
      ocrConfidence?:           number;
    };

    if (!body.reportId) return NextResponse.json({ error: "reportId requerido" }, { status: 400 });
    if (!body.subtotal || body.subtotal <= 0) return NextResponse.json({ error: "El subtotal debe ser mayor a 0" }, { status: 400 });

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

    // Auto-detect if needs documento equivalente
    const docType = (body.documentTypeDetected ?? "unknown") as string;
    const needsDE = body.needsDocumentoEquivalente ??
      (docType === "receipt" || docType === "cuenta_cobro");

    // Determine NS record type
    const nsRecordType = body.paymentMethod === "company_pays_vendor" && docType === "invoice"
      ? "vendor_bill" as const
      : "expense_report" as const;

    const itemId = randomUUID();

    await db.insert(expenseItems).values({
      id:                       itemId,
      reportId:                 body.reportId,
      lineNumber:               nextLine,
      categoryId:               body.categoryId ?? null,
      departmentId:             body.departmentId ?? null,
      classId:                  body.classId ?? null,
      expenseDate:              body.expenseDate ? new Date(body.expenseDate) : null,
      description:              body.description?.trim() || null,
      vendorName:               body.vendorName?.trim() || null,
      vendorNit:                body.vendorNit?.trim() || null,
      invoiceNumber:            body.invoiceNumber?.trim() || null,
      invoiceDate:              body.invoiceDate ? new Date(body.invoiceDate) : null,
      subtotal:                 String(body.subtotal),
      taxAmount:                String(body.taxAmount ?? 0),
      retentionAmount:          String(body.retentionAmount ?? 0),
      total:                    String(body.total),
      currency:                 body.currency ?? "COP",
      paymentMethod:            body.paymentMethod,
      documentTypeDetected:     docType as any,
      needsDocumentoEquivalente: needsDE,
      nsRecordType,
    });

    if (body.fileKey) {
      await db.insert(expenseDocuments).values({
        itemId:               itemId,
        fileKey:              body.fileKey,
        mimeType:             body.mimeType || null,
        originalName:         body.originalName || null,
        ocrRaw:               body.ocrRaw ?? null,
        ocrConfidence:        body.ocrConfidence != null ? String(body.ocrConfidence) : null,
        documentTypeDetected: docType as any,
      });
    }

    return NextResponse.json({ ok: true, itemId }, { status: 201 });
  } catch (err) {
    console.error("[expenses/items POST]", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
