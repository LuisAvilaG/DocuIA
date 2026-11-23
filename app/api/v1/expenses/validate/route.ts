import { withApiSecurity } from "@/lib/security/http";
/**
 * Real-time validation endpoint for expense item form.
 * Checks: duplicate invoice, spending cap, fiscal ID format.
 */
import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { isFeatureEnabled } from "@/lib/features";
import { db } from "@/lib/db";
import { expenseItems, expenseReports, expenseCategories } from "@/db/schema";
import { eq, and, gte, lt, ne, or, isNull, isNotNull, sql } from "drizzle-orm";
import { orgTimeZone } from "@/lib/org-time-zone";
import { dayIn, startOfDayIn } from "@/lib/time-zone";
import { validateFiscalId } from "@/lib/expense/tax-engine";
import { getExpenseManagementConfig } from "@/lib/expense/config";

async function handlePOST(req: NextRequest) {
  const session = await getTenantSession({ area: "expenses", permission: "write" });
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
    expenseDate,
  } = await req.json() as {
    expenseDate?:   string;
    vendorNit?:     string;
    invoiceNumber?: string;
    subtotal?:      number;
    categoryId?:    number;
    excludeItemId?: string;
  };
  const config = await getExpenseManagementConfig(session.orgId);

  const warnings: { type: string; message: string }[] = [];

  // ── 1. Fiscal ID format ───────────────────────────────────────────
  if (vendorNit) {
    const valid = validateFiscalId(config.countryCode, vendorNit);
    if (!valid) {
      warnings.push({ type: "invalid_nit", message: `El NIT/RFC "${vendorNit}" no tiene un formato válido para ${config.countryCode}` });
    }
  }

  // ── 2. Duplicate invoice ──────────────────────────────────────────
  if (config.duplicateCheckEnabled && vendorNit && invoiceNumber) {
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
  if (config.spendingCapsEnabled && categoryId && subtotal && subtotal > 0) {
    const category = await db.query.expenseCategories.findFirst({
      where: and(
        eq(expenseCategories.id, categoryId),
        eq(expenseCategories.organizationId, session.orgId),
      ),
      columns: { dailyCap: true, monthlyCap: true, name: true },
    });

    // The day the expense belongs to: the one on its receipt, else today in the
    // client's zone. A cap adds up what the person spent THAT day or month:
    // counted by the moment of capture, a week of lunches typed on Friday all
    // fell on Friday, and the day changed at midnight UTC.
    const timeZone = await orgTimeZone(session.orgId);
    const today = dayIn(timeZone);
    const day = typeof expenseDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(expenseDate) && !Number.isNaN(Date.parse(expenseDate)) ? expenseDate : today;
    const utc = (d: string) => new Date(`${d}T00:00:00Z`);
    // A dated line is stored at midnight UTC of its date; an undated one counts on the day it was captured.
    const zoned = (d: string) => startOfDayIn(timeZone, new Date(`${d}T12:00:00Z`));
    const plusDay = (d: string) => new Date(utc(d).getTime() + 86_400_000).toISOString().slice(0, 10);
    const monthStart = `${day.slice(0, 7)}-01`;
    const nextMonth = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)), 1)).toISOString().slice(0, 10);

    // What this person already registered in the category between two days (the second excluded).
    const spentBetween = async (from: string, to: string) => {
      const rows = await db
        .select({ total: sql<number>`coalesce(sum(${expenseItems.subtotal}::numeric), 0)` })
        .from(expenseItems)
        .innerJoin(expenseReports, eq(expenseItems.reportId, expenseReports.id))
        .where(
          and(
            eq(expenseReports.organizationId, session.orgId),
            eq(expenseReports.submitterId, session.sub),
            eq(expenseItems.categoryId, categoryId),
            // The line being edited is not added to itself.
            excludeItemId ? ne(expenseItems.id, excludeItemId) : undefined,
            or(
              and(isNotNull(expenseItems.expenseDate), gte(expenseItems.expenseDate, utc(from)), lt(expenseItems.expenseDate, utc(to))),
              and(isNull(expenseItems.expenseDate), isNotNull(expenseItems.invoiceDate), gte(expenseItems.invoiceDate, utc(from)), lt(expenseItems.invoiceDate, utc(to))),
              and(isNull(expenseItems.expenseDate), isNull(expenseItems.invoiceDate), gte(expenseItems.createdAt, zoned(from)), lt(expenseItems.createdAt, zoned(to))),
            ),
          )
        );
      return Number(rows[0]?.total ?? 0);
    };
    const shown = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

    if (category?.dailyCap) {
      const cap = parseFloat(String(category.dailyCap));
      if (cap > 0) {
        const todayAmount = await spentBetween(day, plusDay(day));

        if (todayAmount + subtotal > cap) {
          warnings.push({
            type:    "cap_exceeded",
            message: `Este gasto supera el tope diario de ${category.name} (${cap.toLocaleString("es-CO")}). Acumulado ${day === today ? "hoy" : `el ${shown(day)}`}: ${todayAmount.toLocaleString("es-CO")}`,
          });
        }
      }
    }

    // Monthly cap: same advisory warning, accumulated over the calendar month.
    if (category?.monthlyCap) {
      const cap = parseFloat(String(category.monthlyCap));
      if (cap > 0) {
        const monthAmount = await spentBetween(monthStart, nextMonth);

        if (monthAmount + subtotal > cap) {
          warnings.push({
            // Distinct type: the form keys its warnings by type.
            type:    "monthly_cap_exceeded",
            message: `Este gasto supera el tope mensual de ${category.name} (${cap.toLocaleString("es-CO")}). Acumulado ${day.slice(0, 7) === today.slice(0, 7) ? "este mes" : `en ${day.slice(5, 7)}/${day.slice(0, 4)}`}: ${monthAmount.toLocaleString("es-CO")}`,
          });
        }
      }
    }
  }

  return NextResponse.json({ ok: true, warnings });
}

export const POST = withApiSecurity(handlePOST);
