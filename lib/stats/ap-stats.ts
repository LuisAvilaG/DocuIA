// AP statistics straight from history_documents: automation rate, volume,
// time to the ERP, funnel, vendors (or ERP vendor categories), reasons the
// documents stop and the team's activity.

import { db } from "@/lib/db";
import { catalogVendors, exceptionQueue, historyDocuments, orgUsers } from "@/db/schema";
import { and, desc, eq, gte, inArray, isNotNull, lt, ne, sql, type SQL } from "drizzle-orm";

export type Period = "7d" | "month" | "quarter";

export interface StatsFilters {
  organizationId: string;
  period: Period;
  subsidiaryId: string | null;
  vendor: string | null;
}

export function periodRange(period: Period, now = new Date()): { from: Date; to: Date; prevFrom: Date; label: string; prevLabel: string } {
  const to = now;
  if (period === "month") {
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevFrom = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const month = (d: Date) => d.toLocaleDateString("es-MX", { month: "long" });
    return { from, to, prevFrom, label: `${month(from)} ${from.getFullYear()}`, prevLabel: month(prevFrom) };
  }
  const days = period === "7d" ? 7 : 90;
  const from = new Date(now.getTime() - days * 86_400_000);
  const prevFrom = new Date(from.getTime() - days * 86_400_000);
  return { from, to, prevFrom, label: period === "7d" ? "Últimos 7 días" : "Últimos 90 días", prevLabel: period === "7d" ? "la semana anterior" : "el trimestre anterior" };
}

/** Buckets for the free-text reasons documents stop with. */
export function reasonBucket(reason: string | null): string {
  const r = (reason ?? "").toLowerCase();
  if (/recepci|almac/.test(r)) return "Falta la entrada de almacén";
  if (/cancelad|sat\b|rfc|uuid|fiscal/.test(r)) return "CFDI cancelado, RFC o UUID incorrecto";
  if (/precio|toleranc|total difiere|cantidad/.test(r)) return "Precio o cantidad distinta a la OC";
  if (/\boc\b|orden de compra/.test(r)) return "Sin orden de compra que coincida";
  if (/ítem|item|mape|línea/.test(r)) return "Ítem sin mapear";
  if (/proveedor|vendor/.test(r)) return "Proveedor no identificado";
  if (/extrac|gemini|ia\b|ocr|legible/.test(r)) return "No se pudo leer el documento";
  if (/netsuite|erp|http|timeout|restlet/.test(r)) return "Error al crear en el ERP";
  return "Otros motivos";
}

const vendorIdExpr = sql<string | null>`coalesce(${historyDocuments.products}->'approval_draft'->>'vendorId', ${historyDocuments.products}->'document'->'vendor'->>'selected_internal_id')`;
const poOutcomeExpr = sql<string | null>`(${historyDocuments.products}->'ap_checks'->'po'->'outcome'->>'kind')`;
const isAuto = sql`${historyDocuments.status} = 'completed' and ${historyDocuments.approvedBy} is null`;

export async function loadApStats(f: StatsFilters, opts: { byCategory: boolean }) {
  const range = periodRange(f.period);
  const scope = (from: Date, to: Date): SQL[] => [
    eq(historyDocuments.organizationId, f.organizationId),
    ne(historyDocuments.documentType, "purchase_order"),
    gte(historyDocuments.createdAt, from),
    lt(historyDocuments.createdAt, to),
    ...(f.subsidiaryId ? [eq(historyDocuments.subsidiaryId, f.subsidiaryId)] : []),
    ...(f.vendor ? [eq(historyDocuments.vendor, f.vendor)] : []),
  ];
  const cur = and(...scope(range.from, range.to));
  const prev = and(...scope(range.prevFrom, range.from));
  const trendFrom = new Date(Date.now() - 12 * 7 * 86_400_000);
  const trend = and(...scope(trendFrom, range.to));

  const summary = (where: SQL | undefined) => db.select({
    received:  sql<number>`count(*)::int`,
    extracted: sql<number>`count(*) filter (where ${historyDocuments.status} = 'completed' or ${historyDocuments.vendor} is not null or ${historyDocuments.numDoc} is not null)::int`,
    completed: sql<number>`count(*) filter (where ${historyDocuments.status} = 'completed')::int`,
    auto:      sql<number>`count(*) filter (where ${isAuto})::int`,
    amount:    sql<number>`coalesce(sum(${historyDocuments.total}), 0)::float`,
    medianHours: sql<number | null>`percentile_cont(0.5) within group (order by extract(epoch from (${historyDocuments.updatedAt} - ${historyDocuments.createdAt})) / 3600) filter (where ${historyDocuments.status} = 'completed')`,
  }).from(historyDocuments).where(where);

  const [curRow, prevRow, weeks, vendorsRows, exceptionRows, openExceptions, team] = await Promise.all([
    summary(cur),
    summary(prev),
    db.select({
      week:   sql<string>`to_char(date_trunc('week', ${historyDocuments.createdAt}), 'YYYY-MM-DD')`,
      auto:   sql<number>`count(*) filter (where ${isAuto})::int`,
      review: sql<number>`count(*) filter (where ${historyDocuments.status} = 'completed' and ${historyDocuments.approvedBy} is not null)::int`,
    }).from(historyDocuments).where(trend).groupBy(sql`1`).orderBy(sql`1`),
    opts.byCategory
      ? db.select({
          name:   sql<string>`coalesce(max(${catalogVendors.categoryName}), 'Sin categoría')`,
          count:  sql<number>`count(distinct ${historyDocuments.id})::int`,
          amount: sql<number>`coalesce(sum(${historyDocuments.total}), 0)::float`,
          poChecked: sql<number>`count(distinct ${historyDocuments.id}) filter (where ${poOutcomeExpr} is not null)::int`,
          poOk:      sql<number>`count(distinct ${historyDocuments.id}) filter (where ${poOutcomeExpr} = 'ok')::int`,
          docIds: sql<number[]>`array_agg(distinct ${historyDocuments.id})`,
        }).from(historyDocuments)
          .leftJoin(catalogVendors, and(eq(catalogVendors.subsidiaryId, historyDocuments.subsidiaryId), eq(catalogVendors.internalId, vendorIdExpr)))
          .where(cur).groupBy(catalogVendors.categoryId).orderBy(desc(sql`count(distinct ${historyDocuments.id})`)).limit(8)
      : db.select({
          name:   sql<string>`coalesce(${historyDocuments.vendor}, 'Sin proveedor')`,
          count:  sql<number>`count(*)::int`,
          amount: sql<number>`coalesce(sum(${historyDocuments.total}), 0)::float`,
          poChecked: sql<number>`count(*) filter (where ${poOutcomeExpr} is not null)::int`,
          poOk:      sql<number>`count(*) filter (where ${poOutcomeExpr} = 'ok')::int`,
          docIds: sql<number[]>`array_agg(${historyDocuments.id})`,
        }).from(historyDocuments).where(cur).groupBy(historyDocuments.vendor).orderBy(desc(sql`count(*)`)).limit(8),
    db.select({ reason: exceptionQueue.failureReason, documentId: exceptionQueue.documentId })
      .from(exceptionQueue)
      .where(and(
        eq(exceptionQueue.organizationId, f.organizationId),
        gte(exceptionQueue.createdAt, range.from),
        ...(f.subsidiaryId ? [eq(exceptionQueue.subsidiaryId, f.subsidiaryId)] : []),
      ))
      .limit(5000),
    db.select({ count: sql<number>`count(*)::int` }).from(exceptionQueue)
      .where(and(eq(exceptionQueue.organizationId, f.organizationId), eq(exceptionQueue.status, "pending"))),
    db.select({
      userId:   orgUsers.id,
      name:     orgUsers.fullName,
      email:    orgUsers.email,
      role:     orgUsers.role,
      uploaded: sql<number>`(select count(*) from history_documents h where h.organization_id = ${f.organizationId} and h.processed_by = ${orgUsers.id} and h.created_at >= ${range.from})::int`,
      reviewed: sql<number>`(select count(*) from history_documents h where h.organization_id = ${f.organizationId} and h.products->>'approval_requested_by' = ${orgUsers.id} and h.created_at >= ${range.from})::int`,
      approved: sql<number>`(select count(*) from history_documents h where h.organization_id = ${f.organizationId} and h.approved_by = ${orgUsers.id} and h.created_at >= ${range.from})::int`,
    }).from(orgUsers).where(and(eq(orgUsers.organizationId, f.organizationId), isNotNull(orgUsers.email))),
  ]);

  const c = curRow[0];
  const p = prevRow[0];
  const autoPct = c.completed ? Math.round((c.auto / c.completed) * 100) : null;
  const prevAutoPct = p.completed ? Math.round((p.auto / p.completed) * 100) : null;

  // Exceptions of documents in scope only when filtering by vendor.
  let exceptions = exceptionRows;
  if (f.vendor) {
    const ids = exceptions.map((e) => e.documentId).filter((id): id is number => id !== null);
    const inScope = ids.length
      ? new Set((await db.select({ id: historyDocuments.id }).from(historyDocuments).where(and(inArray(historyDocuments.id, ids.slice(0, 5000)), eq(historyDocuments.vendor, f.vendor)))).map((r) => r.id))
      : new Set<number>();
    exceptions = exceptions.filter((e) => e.documentId !== null && inScope.has(e.documentId));
  }
  const buckets = new Map<string, number>();
  for (const e of exceptions) buckets.set(reasonBucket(e.reason), (buckets.get(reasonBucket(e.reason)) ?? 0) + 1);
  const exceptionDocs = new Map<number, number>();
  for (const e of exceptions) if (e.documentId !== null) exceptionDocs.set(e.documentId, (exceptionDocs.get(e.documentId) ?? 0) + 1);

  return {
    range,
    autoPct,
    autoDelta: autoPct !== null && prevAutoPct !== null ? autoPct - prevAutoPct : null,
    received: c.received,
    amount: c.amount,
    medianHours: c.medianHours === null ? null : Number(c.medianHours),
    exceptions: { total: exceptions.length, open: openExceptions[0]?.count ?? 0, pct: c.received ? Math.round((exceptions.length / c.received) * 1000) / 10 : 0 },
    funnel: [
      { label: "Recibidas", value: c.received },
      { label: "Extraídas", value: c.extracted },
      { label: "Creadas en el ERP", value: c.completed },
      { label: "Sin intervención", value: c.auto },
    ],
    weeks: weeks.map((w) => ({ week: w.week, auto: w.auto, review: w.review })),
    groups: vendorsRows.map((v) => ({
      name: v.name,
      count: v.count,
      amount: v.amount,
      poPct: v.poChecked ? Math.round((v.poOk / v.poChecked) * 100) : null,
      exceptions: (v.docIds ?? []).reduce((s, id) => s + (exceptionDocs.get(Number(id)) ?? 0), 0),
    })),
    reasons: [...buckets.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count).slice(0, 6),
    team: team
      .filter((t) => t.uploaded || t.reviewed || t.approved)
      .map((t) => ({ name: t.name || t.email, role: t.role, uploaded: t.uploaded, reviewed: t.reviewed, approved: t.approved }))
      .sort((a, b) => b.uploaded + b.reviewed + b.approved - (a.uploaded + a.reviewed + a.approved)),
  };
}

export type ApStats = Awaited<ReturnType<typeof loadApStats>>;
