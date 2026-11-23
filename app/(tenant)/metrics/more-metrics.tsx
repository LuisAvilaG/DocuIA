// Métricas nuevas de Facturas (fase 6). Componente de servidor: arma los datos
// y usa las gráficas del kit.
import Link from "next/link";
import { BarList, Donut, Legend, Notice, SERIES, StackedBars, TrendLine } from "@/components/kit";
import { STAGES, type ApMetrics } from "@/lib/stats/ap-metrics";

const num = (n: number) => n.toLocaleString("es-MX");
const money = (n: number, currency: string) => {
  // Currency not read: the amount alone, not labelled as dollars.
  if (!currency) return `$${n.toLocaleString("es-MX", { maximumFractionDigits: 0 })}`;
  try { return n.toLocaleString("es-MX", { style: "currency", currency: currency || "USD", maximumFractionDigits: 0 }); }
  catch { return `${currency} ${n.toLocaleString("es-MX", { maximumFractionDigits: 0 })}`; }
};
function hours(h: number | null) {
  if (h === null) return "—";
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${h.toLocaleString("es-MX", { maximumFractionDigits: 1 })} h`;
  return `${Math.round(h / 24)} días`;
}

const STAGE_COLOR = [SERIES.aqua, SERIES.blue, SERIES.yellow, SERIES.violet, SERIES.red];
const PENDING_SERIES = [
  { key: "reading", label: "Leyendo", color: SERIES.aqua },
  { key: "review", label: "En revisión", color: SERIES.blue },
  { key: "pending_approval", label: "Por aprobar", color: SERIES.yellow },
  { key: "awaiting_receipt", label: "Esperando recepción", color: SERIES.violet },
];
const DONUT = [SERIES.aqua, SERIES.blue, SERIES.yellow, SERIES.violet, SERIES.red, "#8a8578"];

function Section({ title, aside, children, className }: { title: string; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`flex min-w-0 flex-col gap-3.5 ${className ?? ""}`}>
      <div className="flex flex-wrap items-baseline gap-2.5">
        <h2 className="text-[0.9375rem] font-semibold tracking-[-0.01em]">{title}</h2>
        {aside && <span className="ml-auto text-xs text-muted-foreground">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => <p className="text-sm text-muted-foreground">{children}</p>;
const Thin = ({ pct }: { pct: number }) => <div className="h-1.5 rounded-full bg-primary/70" style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />;

export function MoreMetrics({ m }: { m: ApMetrics }) {
  // eslint-disable-next-line react-hooks/purity
  const sinceDays = m.since ? (Date.now() - new Date(m.since).getTime()) / 86_400_000 : 0;
  const sinceLabel = m.since ? new Date(m.since).toLocaleDateString("es-MX", { day: "numeric", month: "long" }) : null;
  const stageSeries = STAGES.map((s, i) => ({ key: s.key, label: s.label, color: STAGE_COLOR[i] }));
  const weekLabel = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("es-MX", { day: "numeric", month: "short" }).replace(".", "");
  const aging = m.aging.map((a) => ({
    reading: (a.values.uploaded ?? 0) + (a.values.extracting ?? 0),
    review: a.values.review ?? 0, pending_approval: a.values.pending_approval ?? 0, awaiting_receipt: a.values.awaiting_receipt ?? 0,
  }));
  const pendingTotal = aging.reduce((s, a) => s + a.reading + a.review + a.pending_approval + a.awaiting_receipt, 0);
  const stale = aging[3] ? aging[3].reading + aging[3].review + aging[3].pending_approval + aging[3].awaiting_receipt : 0;
  const maxPoDiff = Math.max(1, ...m.poDiffs.map((p) => p.difference));
  const maxSub = new Map<string, number>();
  for (const s of m.bySubsidiary) maxSub.set(s.currency, Math.max(maxSub.get(s.currency) ?? 0, s.amount));
  const fbPct = m.fallback.extractions ? Math.round((100 * m.fallback.fallback) / m.fallback.extractions) : null;
  const autoPct = m.mapping.lines ? Math.round((100 * m.mapping.fromMemory) / m.mapping.lines) : null;

  return (
    <>
      <div className="h-px bg-border" />
      {sinceLabel && sinceDays < 14 && (
        <Notice tone="info" title={`Tiempos, antigüedad y correcciones se registran desde el ${sinceLabel}`}>
          Con un par de semanas de uso estas gráficas muestran tendencias confiables.
        </Notice>
      )}

      <div className="grid grid-cols-1 gap-12 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Section title="Dónde se va el tiempo" aside="Mediana por semana, en horas">
          {m.stageWeeks.length === 0 ? <Empty>Todavía no hay cambios de estado suficientes para medir tiempos.</Empty> : (
            <>
              <Legend items={stageSeries} />
              <StackedBars label="Mediana de horas en cada etapa por semana" categories={m.stageWeeks.map((w) => weekLabel(w.week))}
                series={stageSeries} values={m.stageWeeks.map((w) => w.values as Record<string, number>)} fmt={{ unit: " h", decimals: 1 }} />
            </>
          )}
        </Section>
        <Section title="Tiempo por etapa" aside="En el periodo">
          <table className="w-full text-[0.8125rem]">
            <thead><tr className="border-b border-border text-left text-xs text-muted-foreground"><th className="pb-2.5 font-medium">Etapa</th><th className="pb-2.5 text-right font-medium">Mediana</th><th className="pb-2.5 text-right font-medium">9 de cada 10</th></tr></thead>
            <tbody>
              {m.stageTimes.map((s, i) => (
                <tr key={s.key} className="border-b border-border/60">
                  <td className="py-2.5"><span aria-hidden className="mr-2 inline-block size-2.5 rounded-[3px] align-middle" style={{ background: STAGE_COLOR[i] }} />{s.label}</td>
                  <td className="py-2.5 text-right tabular-nums">{hours(s.median)}</td>
                  <td className="py-2.5 text-right tabular-nums text-muted-foreground">{s.p90 === null ? "—" : `≤ ${hours(s.p90)}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      </div>

      <div className="grid grid-cols-1 gap-12 xl:grid-cols-2">
        <Section title="Antigüedad de pendientes" aside={pendingTotal ? `${num(pendingTotal)} pendientes${stale ? ` · ${num(stale)} con más de 7 días` : ""}` : undefined}>
          {pendingTotal === 0 ? <Empty>No hay facturas pendientes.</Empty> : (
            <>
              <Legend items={PENDING_SERIES} />
              <StackedBars label="Facturas pendientes por días de espera y estado" categories={[...m.aging.map((a) => a.bucket)]} series={PENDING_SERIES} values={aging} height={180} />
              {stale > 0 && <Link href="/documents?status=review" className="text-xs font-semibold text-link hover:underline">Ver pendientes</Link>}
            </>
          )}
        </Section>
        <Section title="Precisión de lectura" aside={m.corrections.reviewed ? `${num(m.corrections.corrected)} de ${num(m.corrections.reviewed)} revisadas con correcciones` : undefined}>
          {m.corrections.fields.length === 0 ? <Empty>{m.corrections.reviewed ? "Nadie corrigió datos leídos en el periodo." : "Se mide desde que una factura revisada se envía; aún no hay envíos."}</Empty>
            : <BarList items={m.corrections.fields} labelWidth={170} />}
        </Section>
      </div>

      <div className="grid grid-cols-1 gap-12 xl:grid-cols-2">
        <Section title="Segundo modelo" aside={fbPct === null ? undefined : `${fbPct} % de ${num(m.fallback.extractions)} lecturas`}>
          {m.fallback.extractions === 0 ? <Empty>Sin lecturas en el periodo.</Empty> : m.fallback.reasons.length === 0 ? <Empty>Ninguna factura necesitó un segundo modelo.</Empty> : (
            <div className="flex flex-wrap items-center gap-8">
              <Donut parts={m.fallback.reasons.map((r, i) => ({ ...r, color: DONUT[i % DONUT.length] }))} center={num(m.fallback.fallback)} sub="facturas" />
              {m.fallback.months.length > 1 && <div className="min-w-[220px] flex-1"><p className="mb-1 text-xs text-muted-foreground">% por mes</p><TrendLine label="Porcentaje de lecturas con segundo modelo por mes" points={m.fallback.months} fmt={{ unit: " %", decimals: 0 }} height={110} /></div>}
            </div>
          )}
        </Section>
        <Section title="Auto-mapeo" aside={autoPct === null ? undefined : `${autoPct} % de ${num(m.mapping.lines)} líneas asignadas solas`}>
          {m.mapping.weeks.length === 0 && m.mapping.newMappings.length === 0 ? <Empty>Se mide desde que se leen facturas nuevas; aún no hay datos.</Empty> : (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              {m.mapping.weeks.length > 0 && <div><p className="mb-1 text-xs text-muted-foreground">% de líneas por semana</p><TrendLine label="Porcentaje de líneas asignadas por la memoria de mapeos" points={m.mapping.weeks} fmt={{ unit: " %", decimals: 0 }} height={110} /></div>}
              {m.mapping.newMappings.length > 0 && <div><p className="mb-1 text-xs text-muted-foreground">Mapeos nuevos por semana</p><StackedBars label="Mapeos nuevos por semana" categories={m.mapping.newMappings.map((w) => w.label)} series={[{ key: "n", label: "Mapeos nuevos", color: SERIES.aqua }]} values={m.mapping.newMappings.map((w) => ({ n: w.value }))} height={130} /></div>}
            </div>
          )}
        </Section>
      </div>

      <div className="grid grid-cols-1 gap-12 xl:grid-cols-2">
        <Section title="Duplicados evitados" aside={m.duplicates.count ? `${num(m.duplicates.count)} en el periodo` : undefined}>
          {m.duplicates.count === 0 ? <Empty>No se detectaron facturas duplicadas en el periodo.</Empty> : (
            <>
              <p className="text-[1.75rem] font-semibold tabular-nums tracking-[-0.02em]">{m.duplicates.byCurrency.map((c) => money(c.amount, c.currency)).join(" · ") || num(m.duplicates.count)}</p>
              <p className="-mt-2 text-xs text-muted-foreground">que se habrían pagado dos veces</p>
              <table className="w-full text-[0.8125rem]">
                <tbody>
                  {m.duplicates.list.map((d) => (
                    <tr key={d.id} className="border-b border-border/60">
                      <td className="py-2 pr-3"><Link href={`/history/${d.of}`} className="text-link hover:underline">{d.vendor ?? "Proveedor"} #{d.number ?? d.of}</Link></td>
                      <td className="py-2 text-right tabular-nums">{d.amount === null ? "—" : money(d.amount, d.currency ?? "")}</td>
                      <td className="py-2 text-right text-xs text-muted-foreground">{new Date(d.at).toLocaleDateString("es-MX", { day: "numeric", month: "short" })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </Section>
        <Section title="Rechazos del ERP" aside={m.erpRejections.length ? `${num(m.erpRejections.reduce((a, r) => a + r.value, 0))} en el periodo` : undefined}>
          {m.erpRejections.length === 0 ? <Empty>El ERP no rechazó envíos en el periodo.</Empty> : <BarList items={m.erpRejections} labelWidth={190} />}
        </Section>
      </div>

      <Section title="Diferencias con la OC" aside="Aceptadas por tolerancia o con aprobación">
        {m.poDiffs.length === 0 ? <Empty>Ninguna factura se envió con diferencias contra su orden de compra en el periodo.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full text-[0.8125rem]">
              <thead><tr className="border-b border-border text-left text-xs text-muted-foreground"><th className="pb-2.5 font-medium">Proveedor</th><th className="pb-2.5 text-right font-medium">Por tolerancia</th><th className="pb-2.5 text-right font-medium">Con aprobación</th><th className="w-48 pb-2.5 font-medium">Diferencia aceptada</th></tr></thead>
              <tbody>
                {m.poDiffs.map((p) => (
                  <tr key={p.vendor} className="border-b border-border/60">
                    <td className="max-w-[240px] truncate py-2.5 pr-3">{p.vendor}</td>
                    <td className="py-2.5 text-right tabular-nums">{num(p.tolerance)}</td>
                    <td className="py-2.5 text-right tabular-nums">{num(p.approval)}</td>
                    <td className="py-2.5 pl-4"><div className="flex items-center gap-2"><div className="w-24"><Thin pct={(p.difference / maxPoDiff) * 100} /></div><span className="tabular-nums">{p.difference.toLocaleString("es-MX", { maximumFractionDigits: 0 })}</span></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <div className="grid grid-cols-1 gap-12 xl:grid-cols-2">
        <Section title="Respuesta de aprobadores" aside="Desde que llega a aprobación">
          {m.approvers.length === 0 ? <Empty>Sin aprobaciones registradas en el periodo.</Empty> : (
            <table className="w-full text-[0.8125rem]">
              <thead><tr className="border-b border-border text-left text-xs text-muted-foreground"><th className="pb-2.5 font-medium">Persona</th><th className="pb-2.5 text-right font-medium">Aprobó</th><th className="pb-2.5 text-right font-medium">Mediana</th></tr></thead>
              <tbody>
                {m.approvers.map((a) => (
                  <tr key={a.name} className="border-b border-border/60"><td className="py-2.5">{a.name}</td><td className="py-2.5 text-right tabular-nums">{num(a.count)}</td><td className="py-2.5 text-right tabular-nums">{hours(a.median)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
        <Section title="Monto por subsidiaria" aside="Enviado al ERP, en su moneda">
          {m.bySubsidiary.length === 0 ? <Empty>Sin facturas enviadas al ERP en el periodo.</Empty> : (
            <table className="w-full text-[0.8125rem]">
              <tbody>
                {m.bySubsidiary.map((s) => (
                  <tr key={`${s.name}-${s.currency}`} className="border-b border-border/60">
                    <td className="max-w-[200px] truncate py-2.5 pr-3">{s.name}</td>
                    <td className="w-32 py-2.5 pr-3"><Thin pct={(s.amount / (maxSub.get(s.currency) || 1)) * 100} /></td>
                    <td className="py-2.5 text-right tabular-nums">{money(s.amount, s.currency)}</td>
                    <td className="py-2.5 text-right text-xs text-muted-foreground">{num(s.count)} fact.</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      </div>
    </>
  );
}
