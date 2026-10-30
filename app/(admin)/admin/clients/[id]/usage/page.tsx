import { notFound } from "next/navigation";
import { and, eq, gte, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import { historyDocuments, contractCases, expenseReports, usageDaily } from "@/db/schema";
import { loadOneOrgFacts } from "@/lib/admin/health";
import { SectionTitle, num } from "@/components/admin/ui";

const WEEKS = 8;

export default async function ClientUsagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const facts = await loadOneOrgFacts(id);
  if (!facts) notFound();
  // Server component: the window is computed once per request.
  // eslint-disable-next-line react-hooks/purity
  const since = new Date(Date.now() - WEEKS * 7 * 86_400_000);
  const weekOf = (col: AnyPgColumn) => sql<string>`to_char(date_trunc('week', ${col}), 'YYYY-MM-DD')`;

  const [docs, cases, reports, ai, byStatus] = await Promise.all([
    db.select({ week: weekOf(historyDocuments.createdAt), n: sql<number>`count(*)::int` }).from(historyDocuments)
      .where(and(eq(historyDocuments.organizationId, id), gte(historyDocuments.createdAt, since))).groupBy(weekOf(historyDocuments.createdAt)),
    db.select({ week: weekOf(contractCases.createdAt), n: sql<number>`count(*)::int` }).from(contractCases)
      .where(and(eq(contractCases.organizationId, id), gte(contractCases.createdAt, since))).groupBy(weekOf(contractCases.createdAt)),
    db.select({ week: weekOf(expenseReports.createdAt), n: sql<number>`count(*)::int` }).from(expenseReports)
      .where(and(eq(expenseReports.organizationId, id), gte(expenseReports.createdAt, since))).groupBy(weekOf(expenseReports.createdAt)),
    db.select({
      primary: sql<number>`coalesce(sum(${usageDaily.aiPrimaryCalls}),0)::int`, fallback: sql<number>`coalesce(sum(${usageDaily.aiFallbackCalls}),0)::int`,
      errors: sql<number>`coalesce(sum(${usageDaily.errors}),0)::int`, amount: sql<string>`coalesce(sum(${usageDaily.totalAmount}),0)::text`,
    }).from(usageDaily).where(and(eq(usageDaily.organizationId, id), gte(usageDaily.date, since.toISOString().slice(0, 10)))),
    db.select({ status: historyDocuments.status, n: sql<number>`count(*)::int` }).from(historyDocuments)
      .where(and(eq(historyDocuments.organizationId, id), gte(historyDocuments.createdAt, since))).groupBy(historyDocuments.status),
  ]);

  // Build the week axis (oldest first) so empty weeks still show.
  const weeks: string[] = [];
  const start = new Date(since); start.setHours(0, 0, 0, 0);
  const day = start.getDay(); start.setDate(start.getDate() - ((day + 6) % 7));
  for (let i = 0; i <= WEEKS; i++) { const d = new Date(start.getTime() + i * 7 * 86_400_000); weeks.push(d.toISOString().slice(0, 10)); }
  const series = [
    { key: "docs", label: "Documentos AP", rows: docs, show: facts.products.some((p) => p.key === "ap_automation" && p.status !== "disabled") },
    { key: "cases", label: "Casos de contratos", rows: cases, show: facts.products.some((p) => p.key === "contract_intelligence" && p.status !== "disabled") },
    { key: "reports", label: "Informes de gastos", rows: reports, show: facts.products.some((p) => p.key === "expense_management" && p.status !== "disabled") },
  ].filter((s) => s.show || s.rows.length > 0);
  const a = ai[0];
  const fallbackPct = Number(a?.primary) > 0 ? Math.round((Number(a.fallback) / Number(a.primary)) * 100) : null;
  const statusMap = new Map<string, number>(byStatus.map((s) => [s.status, Number(s.n)]));

  return (
    <>
      <section>
        <h2 className="text-[22px] font-semibold tracking-[-0.02em]">
          {num(facts.usage30.docs)} documentos, {num(facts.usage30.cases)} casos y {num(facts.usage30.reports)} informes en 30 días.
        </h2>
        <p className="text-[15px] text-muted-foreground mt-1.5">
          {fallbackPct === null ? "Sin llamadas de IA registradas en 8 semanas" : `El ${fallbackPct} % de las extracciones cayó al modelo secundario en 8 semanas`}
          {Number(a?.errors) > 0 ? ` · ${num(Number(a.errors))} errores` : ""}.
        </p>
      </section>

      {series.map((s) => {
        const by = new Map(s.rows.map((r) => [r.week, Number(r.n)]));
        const values = weeks.map((w) => by.get(w) ?? 0);
        const max = Math.max(1, ...values);
        const total = values.reduce((x, y) => x + y, 0);
        return (
          <section key={s.key}>
            <SectionTitle aside={`${num(total)} en 8 semanas`}>{s.label}</SectionTitle>
            <div className="mt-4 flex flex-col gap-2">
              {weeks.map((w, i) => (
                <div key={w} className="grid grid-cols-[72px_minmax(0,1fr)_60px] items-center gap-3 text-xs">
                  <span className="text-muted-foreground tabular-nums">{new Date(w + "T00:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "short" })}</span>
                  <span className="block h-1.5 rounded bg-secondary overflow-hidden"><span className="block h-full rounded bg-primary" style={{ width: `${Math.round((values[i] / max) * 100)}%` }} /></span>
                  <span className="text-right tabular-nums">{values[i] || "—"}</span>
                </div>
              ))}
            </div>
          </section>
        );
      })}

      {byStatus.length > 0 && (
        <section>
          <SectionTitle>Documentos AP por estado (8 semanas)</SectionTitle>
          <ul className="mt-3 grid grid-cols-2 gap-x-8 text-[13px]">
            {["completed", "review", "pending_approval", "awaiting_receipt", "processing", "failed", "uploaded", "extracting"].filter((k) => statusMap.has(k)).map((k) => (
              <li key={k} className="flex justify-between py-1.5 border-b border-border/60"><span className="text-muted-foreground">{k}</span><span className="tabular-nums">{num(statusMap.get(k) ?? 0)}</span></li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
