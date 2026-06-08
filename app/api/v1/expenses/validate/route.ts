/**
 * Real-time validation endpoint for expense item form.
 * Checks: duplicate invoice, spending cap, fiscal ID format.
 */
import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { isFeatureEnabled } from "@/lib/features";
import { db } from "@/lib/db";
import { expenseItems, expenseReports, expenseCategories } from "@/db/schema";
import { eq, and, gte, sql } from "drizzle-orm";
import { validateFiscalId } from "@/lib/expense/tax-engine";

export async function POST(req: NextRequest) {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!await isFeatureEnabled(session.orgId, "expense_management")) {
    return NextResponse.json({ error: "Módulo de gastos no activado" }, { status: 403 });
  }

  const {
    vendorNit,
    invoiceNumber,
    subtotal,
    categoryId,
    excludeItemId,
    countryCode = "CO",
  } = await req.json() as {
    vendorNit?:     string;
    invoiceNumber?: string;
    subtotal?:      number;
    categoryId?:    number;
    excludeItemId?: string;
    countryCode?:   string;
  };

  const warnings: { type: string; message: string }[] = [];

  // ── 1. Fiscal ID format ───────────────────────────────────────────
  if (vendorNit) {
    const valid = validateFiscalId(countryCode, vendorNit);
    if (!valid) {
      warnings.push({ type: "invalid_nit", message: `El NIT/RFC "${vendorNit}" no tiene un formato válido para ${countryCode}` });
    }
  }

  // ── 2. Duplicate invoice ──────────────────────────────────────────
  if (vendorNit && invoiceNumber) {
    const existingItems = await db
      .select({ id: expenseItems.id, reportId: expenseItems.reportId })
      .from(expenseItems)
      .innerJoin(expenseReports, eq(expenseItems.reportId, expenseReports.id))
      .where(
        and(
          eq(expenseReports.organizationId, session.orgId),
          eq(expenseItems.vendorNit, vendorNit.trim()),
          eq(expenseItems.invoiceNumber, invoiceNumber.trim()),
        )
      )
      .limit(3);

    const others = excludeItemId
      ? existingItems.filter(i => i.id !== excludeItemId)
      : existingItems;

    if (others.length > 0) {
      warnings.push({ type: "duplicate_invoice", message: `Esta factura (${invoiceNumber}) ya fue registrada en otro informe de gastos` });
    }
  }

  // ── 3. Daily spending cap ─────────────────────────────────────────
  if (categoryId && subtotal && subtotal > 0) {
    const category = await db.query.expenseCategories.findFirst({
      where: and(
        eq(expenseCategories.id, categoryId),
        eq(expenseCategories.organizationId, session.orgId),
      ),
      columns: { dailyCap: true, name: true },
    });

    if (category?.dailyCap) {
      const cap = parseFloat(String(category.dailyCap));
      if (cap > 0) {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const todayTotal = await db
          .select({ total: sql<number>`coalesce(sum(${expenseItems.subtotal}::numeric), 0)` })
          .from(expenseItems)
          .innerJoin(expenseReports, eq(expenseItems.reportId, expenseReports.id))
          .where(
            and(
              eq(expenseReports.organizationId, session.orgId),
              eq(expenseReports.submitterId, session.sub),
              eq(expenseItems.categoryId, categoryId),
              gte(expenseItems.createdAt, todayStart),
            )
          );

        const todayAmount = Number(todayTotal[0]?.total ?? 0);

        if (todayAmount + subtotal > cap) {
          warnings.push({
            type:    "cap_exceeded",
            message: `Este gasto supera el tope diario de ${category.name} (${cap.toLocaleString("es-CO")}). Acumulado hoy: ${todayAmount.toLocaleString("es-CO")}`,
          });
        }
      }
    }
  }

  return NextResponse.json({ ok: true, warnings });
}
