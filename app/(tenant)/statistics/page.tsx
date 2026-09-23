import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getTenantSession } from "@/lib/auth/jwt";
import { requireApAutomation } from "@/lib/products";
import { db } from "@/lib/db";
import { expenseItems, expenseReports, historyDocuments, orgUsers, subsidiaries } from "@/db/schema";
import { and, count, desc, eq, gte, isNotNull, sql, sum } from "drizzle-orm";
import { isFeatureEnabled } from "@/lib/features";
import { loadApStats, type ApStats, type Period } from "@/lib/stats/ap-stats";
import { StatsFilters } from "./filters";

type Search = { period?: string; sub?: string; vendor?: string; group?: string };

const num = (n: number) => n.toLocaleString("es-MX");
function compactMoney(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toLocaleString("es-MX", { maximumFractionDigits: 1 })} M`;
  if (n >= 10_000) return `$${(n / 1_000).toLocaleString("es-MX", { maximumFractionDigits: 0 })} mil`;
  return `$${n.toLocaleString("es-MX", { maximumFractionDigits: 0 })}`;
}
function duration(hours: number | null) {
  if (hours === null) return "—";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 48) return `${hours.toLocaleString("es-MX", { maximumFractionDigits: 1 })} h`;
  return `${Math.round(hours / 24)} días`;
}

const ROLE_LABEL: Record<string, string> = { admin: "administrador", approver: "aprobador", accountant: "contador", operator: "operador", viewer: "consulta", expense_submitter: "gastos" };

// ── Charts (server-rendered SVG, hover via <title>) ──────────────────────────

function Sparkline({ values }: { values: number[] }) {
  const W = 300, H = 70, pad = 6;
  if (values.length < 2) return <p className="text-xs text-muted-foreground">Sin datos suficientes</p>;
  const min = Math.min(...values), max = Math.max(...values);
  const span = Math.max(10, max - min);
  const lo = Math.max(0, min - span * 0.2), hi = Math.min(100, lo + span * 1.4);
  const x = (i: number) => pad + (i / (values.length - 1)) * (W - pad * 2);
  const y = (v: number) => H - pad - ((v - lo) / (hi - lo || 1)) * (H - pad * 2);
  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join("");
  const area = `${line}L${x(values.length - 1).toFixed(1)} ${H}L${x(0).toFixed(1)} ${H}Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-[300px] max-w-full h-auto" role="img" aria-label={`Porcentaje sin intervención por semana, de ${values[0]}% a ${values[values.length - 1]}%`}>
      <path d={area} fill="var(--viz-auto)" fillOpacity={0.1} />
      <path d={line} fill="none" stroke="var(--viz-auto)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {values.map((v, i) => (
        <g key={i}>
          <title>{`Semana ${i + 1}: ${v}%`}</title>
          <rect x={x(i) - 10} y={0} width={20} height={H} fill="transparent" />
        </g>
      ))}
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r={4.5} fill="var(--viz-auto)" stroke="var(--card)" strokeWidth={2} />
    </svg>
  );
}

function WeeklyBars({ weeks }: { weeks: ApStats["weeks"] }) {
  const W = 820, H = 250, left = 44, base = 204, top = 20;
  if (!weeks.length) return <p className="text-sm text-muted-foreground py-10">Sin facturas creadas en el ERP en las últimas 12 semanas.</p>;
  const max = Math.max(4, ...weeks.map((w) => w.auto + w.review));
  // Round tick step (1, 2, 2.5 or 5 × 10^n) giving about three intervals.
  const rough = max / 3;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * mag >= rough) ?? 10) * mag;
  const nice = Math.ceil(max / step) * step;
  const ticks = Array.from({ length: Math.round(nice / step) + 1 }, (_, i) => i * step);
  const y = (v: number) => base - (v / nice) * (base - top);
  const slot = (W - left) / weeks.length;
  const bw = Math.min(22, slot * 0.45);
  const last = weeks[weeks.length - 1];
  const label = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("es-MX", { day: "numeric", month: "short" }).replace(".", "");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Facturas creadas en el ERP por semana, automáticas y con revisión">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={left} x2={W - 4} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={1} />
          <text x={left - 8} y={y(t) + 4} textAnchor="end" fontSize={11} className="fill-muted-foreground">{num(t)}</text>
        </g>
      ))}
      {weeks.map((w, i) => {
        const cx = left + slot * i + slot / 2;
        const x = cx - bw / 2;
        const hAuto = base - y(w.auto);
        const hRev = base - y(w.review);
        const gap = w.auto && w.review ? 2 : 0;
        const topRev = base - hAuto - gap - hRev;
        const r = Math.min(4, hRev || hAuto);
        return (
          <g key={w.week}>
            <title>{`Semana del ${label(w.week)}: ${num(w.auto)} automáticas, ${num(w.review)} con revisión`}</title>
            <rect x={left + slot * i} y={top} width={slot} height={base - top} fill="transparent" />
            {w.auto > 0 && (
              w.review > 0
                ? <rect x={x} y={base - hAuto} width={bw} height={hAuto} fill="var(--viz-auto)" />
                : <path d={`M${x} ${base}V${base - hAuto + r}Q${x} ${base - hAuto} ${x + r} ${base - hAuto}H${x + bw - r}Q${x + bw} ${base - hAuto} ${x + bw} ${base - hAuto + r}V${base}Z`} fill="var(--viz-auto)" />
            )}
            {w.review > 0 && (
              <path d={`M${x} ${topRev + hRev}V${topRev + r}Q${x} ${topRev} ${x + r} ${topRev}H${x + bw - r}Q${x + bw} ${topRev} ${x + bw} ${topRev + r}V${topRev + hRev}Z`} fill="var(--viz-review)" />
            )}
            {(i % 2 === weeks.length % 2 || weeks.length <= 6) && (
              <text x={cx} y={228} textAnchor="middle" fontSize={11} className="fill-muted-foreground">{label(w.week)}</text>
            )}
          </g>
        );
      })}
      <text x={left + slot * (weeks.length - 1) + slot / 2} y={y(last.auto + last.review) - 8} textAnchor="middle" fontSize={12} fontWeight={600} className="fill-foreground">{num(last.auto + last.review)}</text>
    </svg>
  );
}

function Thin({ pct }: { pct: number }) {
  return <div className="h-1.5 rounded-full bg-primary/70" style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />;
}

export default async function StatisticsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const session = await getTenantSession({ area: "documents" });
  if (!session) redirect("/login");
  await requireApAutomation(session.orgId);
  if (!await isFeatureEnabled(session.orgId, "advanced_analytics")) redirect("/dashboard");

  const sp = await searchParams;
  const period: Period = sp.period === "7d" || sp.period === "quarter" ? sp.period : "month";
  const [subs, vendorList, categoryStats] = await Promise.all([
    db.select({ id: subsidiaries.id, name: subsidiaries.name }).from(subsidiaries).where(eq(subsidiaries.organizationId, session.orgId)),
    db.select({ vendor: historyDocuments.vendor }).from(historyDocuments)
      .where(and(eq(historyDocuments.organizationId, session.orgId), isNotNull(historyDocuments.vendor), gte(historyDocuments.createdAt, sql`now() - interval '180 days'`)))
      .groupBy(historyDocuments.vendor).orderBy(desc(sql`count(*)`)).limit(200),
    isFeatureEnabled(session.orgId, "ap_advanced_stats"),
  ]);
  const subsidiaryId = sp.sub && subs.some((s) => s.id === sp.sub) ? sp.sub : null;
  const vendor = sp.vendor?.trim() ? sp.vendor.trim().slice(0, 191) : null;
  const byCategory = categoryStats && sp.group === "category";

  let stats: ApStats | null = null;
  try {
    stats = await loadApStats({ organizationId: session.orgId, period, subsidiaryId, vendor }, { byCategory });
  } catch (err) {
    console.error("[statistics]", err);
  }

  // Expense summary for admins with the module enabled.
  let expense: { synced: number; byStatus: Record<string, number>; submitters: number } | null = null;
  if (session.role === "admin" && await isFeatureEnabled(session.orgId, "expense_management")) {
    try {
      const [totalRow, byStatus, submitterRow] = await Promise.all([
        db.select({ total: sum(expenseItems.total) }).from(expenseItems)
          .innerJoin(expenseReports, eq(expenseItems.reportId, expenseReports.id))
          .where(and(eq(expenseReports.organizationId, session.orgId), eq(expenseReports.status, "synced"))),
        db.select({ status: expenseReports.status, n: count() }).from(expenseReports)
          .where(eq(expenseReports.organizationId, session.orgId)).groupBy(expenseReports.status),
        db.select({ n: count() }).from(orgUsers)
          .where(and(eq(orgUsers.organizationId, session.orgId), eq(orgUsers.role, "expense_submitter"))),
      ]);
      expense = {
        synced: Number(totalRow[0]?.total ?? 0),
        byStatus: Object.fromEntries(byStatus.map((r) => [r.status, Number(r.n)])),
        submitters: Number(submitterRow[0]?.n ?? 0),
      };
    } catch (err) {
      console.error("[statistics/expense]", err);
    }
  }

  const maxGroup = Math.max(1, ...(stats?.groups.map((g) => g.count) ?? [1]));
  const maxReason = Math.max(1, ...(stats?.reasons.map((r) => r.count) ?? [1]));
  const trend = stats?.weeks.filter((w) => w.auto + w.review > 0).map((w) => Math.round((w.auto / (w.auto + w.review)) * 100)) ?? [];

  return (
    <div className="flex-1 overflow-auto">
      <div className="px-6 md:px-12 py-8 flex flex-col gap-7 max-w-[1320px]">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-[-0.02em] text-foreground">Estadísticas</h1>
            <span className="text-xs text-muted-foreground first-letter:uppercase">{stats?.range.label ?? ""}{vendor ? ` · ${vendor}` : ""}</span>
          </div>
          <div className="ml-auto">
            <Suspense>
              <StatsFilters subsidiaries={subs} vendors={vendorList.map((v) => v.vendor as string)} groupToggle={categoryStats} />
            </Suspense>
          </div>
        </div>

        {!stats ? (
          <p className="text-sm text-muted-foreground">No se pudieron calcular las estadísticas. Intenta recargar la página.</p>
        ) : (
          <>
            {/* Headline */}
            <div className="flex flex-wrap gap-x-14 gap-y-6 items-end">
              <div className="flex flex-col gap-1.5 w-full sm:w-[420px]">
                <span className="text-xs font-semibold text-muted-foreground">Sin intervención</span>
                <div className="flex items-baseline gap-3.5">
                  <span className="text-[4rem] font-semibold tracking-[-0.035em] leading-none tabular-nums text-foreground">{stats.autoPct === null ? "—" : `${stats.autoPct}%`}</span>
                  {stats.autoDelta !== null && (
                    <span className={`text-[0.8125rem] font-semibold ${stats.autoDelta >= 0 ? "text-success" : "text-destructive"}`}>
                      {stats.autoDelta >= 0 ? "+" : "−"}{Math.abs(stats.autoDelta)} pts vs {stats.range.prevLabel}
                    </span>
                  )}
                </div>
                <span className="text-sm leading-relaxed text-foreground/80">de las facturas llegó al ERP sin que nadie tuviera que revisarla.</span>
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-muted-foreground">Tendencia semanal</span>
                <Sparkline values={trend} />
              </div>
              <div className="lg:ml-auto flex flex-wrap gap-10">
                <div className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted-foreground">Facturas</span><span className="text-[1.75rem] font-semibold tracking-[-0.02em] tabular-nums">{num(stats.received)}</span><span className="text-xs text-muted-foreground">{compactMoney(stats.amount)}</span></div>
                <div className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted-foreground">Tiempo al ERP</span><span className="text-[1.75rem] font-semibold tracking-[-0.02em] tabular-nums">{duration(stats.medianHours)}</span><span className="text-xs text-muted-foreground">mediana desde la carga</span></div>
                <div className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted-foreground">Excepciones</span><span className="text-[1.75rem] font-semibold tracking-[-0.02em] tabular-nums">{num(stats.exceptions.total)}</span><span className="text-xs text-muted-foreground">{stats.exceptions.pct}% · {num(stats.exceptions.open)} abiertas</span></div>
              </div>
            </div>

            <div className="h-px bg-border" />

            {/* Weekly volume + funnel */}
            <div className="flex flex-col xl:flex-row gap-12">
              <section className="flex flex-col gap-3.5 xl:w-[62%] min-w-0">
                <div className="flex flex-wrap items-center gap-4">
                  <h2 className="text-[0.9375rem] font-semibold tracking-[-0.01em]">Facturas por semana</h2>
                  <span className="inline-flex items-center gap-1.5 text-xs text-foreground/80"><span className="w-2.5 h-2.5 rounded-sm bg-[var(--viz-auto)]" />Automáticas</span>
                  <span className="inline-flex items-center gap-1.5 text-xs text-foreground/80"><span className="w-2.5 h-2.5 rounded-sm bg-[var(--viz-review)]" />Con revisión</span>
                  <span className="ml-auto text-xs text-muted-foreground">Últimas 12 semanas</span>
                </div>
                <WeeklyBars weeks={stats.weeks} />
              </section>
              <section className="flex-1 flex flex-col gap-4">
                <h2 className="text-[0.9375rem] font-semibold tracking-[-0.01em]">Del ingreso al ERP</h2>
                <div className="flex flex-col gap-3.5 text-[0.8125rem]">
                  {stats.funnel.map((s, i) => {
                    const pct = stats!.received ? Math.round((s.value / stats!.received) * 100) : 0;
                    return (
                      <div key={s.label} className="flex flex-col gap-1.5">
                        <div className="flex justify-between gap-3">
                          <span>{s.label}</span>
                          <span className="tabular-nums"><strong>{num(s.value)}</strong>{i > 0 && <span className="ml-1.5 text-xs text-muted-foreground">{pct}%</span>}</span>
                        </div>
                        <Thin pct={i === 0 ? 100 : pct} />
                      </div>
                    );
                  })}
                </div>
                <span className="text-xs text-muted-foreground">Cada paso cuenta cuántas facturas siguieron adelante; el porcentaje es sobre las recibidas.</span>
              </section>
            </div>

            <div className="h-px bg-border" />

            {/* Vendors / categories + reasons */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-12">
              <section className="flex flex-col gap-3.5 min-w-0">
                <div className="flex items-baseline gap-2.5">
                  <h2 className="text-[0.9375rem] font-semibold tracking-[-0.01em]">{byCategory ? "Categorías de proveedor" : "Proveedores"}</h2>
                  <span className="ml-auto text-xs text-muted-foreground">Los {stats.groups.length} con más facturas</span>
                </div>
                {stats.groups.length === 0 ? <p className="text-sm text-muted-foreground">Sin facturas en el periodo.</p> : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-[0.8125rem]">
                      <thead>
                        <tr className="border-b border-border text-left text-xs text-muted-foreground">
                          <th className="pb-2.5 font-medium">{byCategory ? "Categoría" : "Proveedor"}</th>
                          <th className="pb-2.5 font-medium w-40">Facturas</th>
                          <th className="pb-2.5 font-medium text-right">Monto</th>
                          <th className="pb-2.5 font-medium text-right">Cuadran con OC</th>
                          <th className="pb-2.5 font-medium text-right">Excepciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stats.groups.map((g) => (
                          <tr key={g.name} className="border-b border-border/60">
                            <td className="py-2.5 pr-3 max-w-[220px] truncate">{g.name}</td>
                            <td className="py-2.5 pr-3"><div className="flex items-center gap-2"><div className="w-24"><Thin pct={(g.count / maxGroup) * 100} /></div><span className="tabular-nums">{num(g.count)}</span></div></td>
                            <td className="py-2.5 text-right tabular-nums">{compactMoney(g.amount)}</td>
                            <td className="py-2.5 text-right tabular-nums">{g.poPct === null ? <span className="text-muted-foreground">Sin OC</span> : `${g.poPct}%`}</td>
                            <td className="py-2.5 text-right tabular-nums">{num(g.exceptions)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
              <section className="flex flex-col gap-3.5 min-w-0">
                <div className="flex items-baseline gap-2.5">
                  <h2 className="text-[0.9375rem] font-semibold tracking-[-0.01em]">Por qué se detienen</h2>
                  <span className="ml-auto text-xs text-muted-foreground">{num(stats.exceptions.total)} excepciones</span>
                </div>
                {stats.reasons.length === 0 ? <p className="text-sm text-muted-foreground">Sin excepciones en el periodo.</p> : (
                  <table className="w-full text-[0.8125rem]">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted-foreground">
                        <th className="pb-2.5 font-medium">Motivo</th>
                        <th className="pb-2.5 font-medium w-44"><span className="sr-only">Proporción</span></th>
                        <th className="pb-2.5 font-medium text-right">Casos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.reasons.map((r) => (
                        <tr key={r.label} className="border-b border-border/60">
                          <td className="py-2.5 pr-3">{r.label}</td>
                          <td className="py-2.5 pr-3"><Thin pct={(r.count / maxReason) * 100} /></td>
                          <td className="py-2.5 text-right tabular-nums">{num(r.count)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            </div>

            {stats.team.length > 0 && (
              <section className="flex flex-col gap-3.5">
                <h2 className="text-[0.9375rem] font-semibold tracking-[-0.01em]">Equipo</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-[0.8125rem]">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted-foreground">
                        <th className="pb-2.5 font-medium">Persona</th>
                        <th className="pb-2.5 font-medium text-right">Cargó</th>
                        <th className="pb-2.5 font-medium text-right">Envió a aprobación</th>
                        <th className="pb-2.5 font-medium text-right">Aprobó y envió</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.team.slice(0, 12).map((t) => (
                        <tr key={t.name} className="border-b border-border/60">
                          <td className="py-2.5">{t.name} <span className="text-xs text-muted-foreground">({ROLE_LABEL[t.role] ?? t.role})</span></td>
                          <td className="py-2.5 text-right tabular-nums">{t.uploaded ? num(t.uploaded) : "—"}</td>
                          <td className="py-2.5 text-right tabular-nums">{t.reviewed ? num(t.reviewed) : "—"}</td>
                          <td className="py-2.5 text-right tabular-nums">{t.approved ? num(t.approved) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {expense && (
              <>
                <div className="h-px bg-border" />
                <section className="flex flex-col gap-3.5">
                  <h2 className="text-[0.9375rem] font-semibold tracking-[-0.01em]">Gastos</h2>
                  <div className="flex flex-wrap gap-10">
                    <div className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted-foreground">Enviado al ERP</span><span className="text-[1.75rem] font-semibold tabular-nums">{compactMoney(expense.synced)}</span></div>
                    <div className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted-foreground">Reportes por revisar</span><span className="text-[1.75rem] font-semibold tabular-nums">{num((expense.byStatus.submitted ?? 0) + (expense.byStatus.under_review ?? 0))}</span></div>
                    <div className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted-foreground">Reportes enviados al ERP</span><span className="text-[1.75rem] font-semibold tabular-nums">{num(expense.byStatus.synced ?? 0)}</span></div>
                    <div className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted-foreground">Personas que registran gastos</span><span className="text-[1.75rem] font-semibold tabular-nums">{num(expense.submitters)}</span></div>
                  </div>
                </section>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
