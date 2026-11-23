// Métricas nuevas de Contratos (fase 6), calculadas en el servidor sobre las
// últimas 12 semanas. Usa las gráficas del kit.
import Link from "next/link";
import { BarList, Legend, Notice, SERIES, StackedBars, TrendLine } from "@/components/kit";
import type { ContractMetrics } from "@/lib/stats/contract-metrics";

const num = (v: number) => v.toLocaleString("es-MX");
function hours(h: number | null) {
  if (h === null) return "—";
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${h.toLocaleString("es-MX", { maximumFractionDigits: 1 })} h`;
  return `${Math.round(h / 24)} días`;
}
const OUTCOME_SERIES = [
  { key: "clean", label: "Aprobados", color: SERIES.aqua },
  { key: "exception", label: "Aprobados con excepción", color: SERIES.yellow },
  { key: "rejected", label: "Rechazados", color: SERIES.red },
];
const REF_STATUS: Record<string, string> = { missing: "Sin localizar", review: "Revisar", ambiguous: "Varias coincidencias", unrelated: "No pertinente" };

function Panel({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {aside && <span className="ml-auto text-[11px] text-muted-foreground">{aside}</span>}
      </div>
      {children}
    </section>
  );
}
const Empty = ({ children }: { children: React.ReactNode }) => <p className="py-6 text-center text-xs text-muted-foreground">{children}</p>;

export function ContractMoreMetrics({ m }: { m: ContractMetrics }) {
  // eslint-disable-next-line react-hooks/purity
  const sinceDays = m.since ? (Date.now() - new Date(m.since).getTime()) / 86_400_000 : 0;
  const sinceLabel = m.since ? new Date(m.since).toLocaleDateString("es-MX", { day: "numeric", month: "long" }) : null;
  const maxRule = Math.max(1, ...m.rules.map((r) => r.block + r.warn + r.unknown));
  const decided = m.outcomes.reduce((a, o) => a + o.clean + o.exception + o.rejected, 0);
  const exceptions = m.outcomes.reduce((a, o) => a + o.exception, 0);

  return (
    <div className="space-y-4 border-t border-border pt-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">Decisiones y calidad</h2>
        <span className="text-[11px] text-muted-foreground">Últimas 12 semanas · todos los flujos</span>
      </div>
      {sinceLabel && sinceDays < 14 && (
        <Notice tone="info" title={`Los tiempos a decisión se registran desde el ${sinceLabel}`}>Con un par de semanas de uso la tendencia se vuelve confiable.</Notice>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Tiempo a decisión" aside={m.decisionTime.count ? `Mediana ${hours(m.decisionTime.median)} · 9 de cada 10 en ≤ ${hours(m.decisionTime.p90)}` : undefined}>
          {m.decisionTime.weeks.length < 2
            ? <Empty>{m.decisionTime.count ? `${num(m.decisionTime.count)} caso${m.decisionTime.count === 1 ? "" : "s"} decidido${m.decisionTime.count === 1 ? "" : "s"}; la tendencia aparece con dos semanas de datos.` : "Todavía no hay casos decididos con el tiempo registrado."}</Empty>
            : <TrendLine label="Horas de la creación a la decisión, mediana por semana" points={m.decisionTime.weeks} fmt={{ unit: " h", decimals: 1 }} />}
        </Panel>
        <Panel title="Resultado de decisiones" aside={decided ? `${num(decided)} decididos · ${num(exceptions)} con excepción` : undefined}>
          {decided === 0 ? <Empty>Sin decisiones en las últimas 12 semanas.</Empty> : (
            <>
              <Legend items={OUTCOME_SERIES} />
              <StackedBars label="Decisiones por semana: aprobados, con excepción y rechazados" categories={m.outcomes.map((o) => o.label)} series={OUTCOME_SERIES} values={m.outcomes.map(({ clean, exception, rejected }) => ({ clean, exception, rejected }))} height={190} />
            </>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Reglas que más frenan" aside="Bloquean · a revisar · sin verificar">
          {m.rules.length === 0 ? <Empty>Ningún control falló en las últimas 12 semanas.</Empty> : (
            <ul className="flex flex-col">
              {m.rules.map((r) => {
                const total = r.block + r.warn + r.unknown;
                const seg = (v: number) => `${(v / maxRule) * 100}%`;
                return (
                  <li key={r.name} title={`${r.name}: ${r.block} bloquean, ${r.warn} a revisar, ${r.unknown} sin verificar`} className="grid items-center gap-2.5 py-1.5 text-[13px]" style={{ gridTemplateColumns: "minmax(80px, 170px) minmax(60px, 1fr) auto" }}>
                    <span className="truncate">{r.name}</span>
                    <span className="flex h-2 overflow-hidden rounded-full bg-secondary">
                      <span style={{ width: seg(r.block), background: SERIES.red }} />
                      <span style={{ width: seg(r.warn), background: SERIES.yellow }} />
                      <span style={{ width: seg(r.unknown), background: "#a8a39a" }} />
                    </span>
                    <span className="tabular-nums text-xs text-muted-foreground">{total}</span>
                  </li>
                );
              })}
            </ul>
          )}
          {m.rules.length > 0 && <Legend items={[{ label: "Bloquean", color: SERIES.red }, { label: "A revisar", color: SERIES.yellow }, { label: "Sin verificar", color: "#a8a39a" }]} />}
        </Panel>
        <Panel title="Correcciones por campo" aside={m.corrections.total ? `${num(m.corrections.total)} correcciones · ${num(m.corrections.learned)} como aprendizaje` : undefined}>
          {m.corrections.fields.length === 0 ? <Empty>Nadie corrigió datos leídos por la IA en las últimas 12 semanas.</Empty> : <BarList items={m.corrections.fields} labelWidth={170} />}
          <p className="text-[11px] text-muted-foreground">{num(m.corrections.activeLearnings)} aprendizaje{m.corrections.activeLearnings === 1 ? "" : "s"} activo{m.corrections.activeLearnings === 1 ? "" : "s"} · <Link href="/contracts/quality" className="text-link hover:underline">Ver aprendizajes</Link></p>
        </Panel>
      </div>

      <Panel title="Impacto de cada versión" aside="Casos analizados con cada versión publicada">
        {m.versions.length === 0 ? <Empty>Los casos guardan su versión desde que se activan las versiones de flujo; aún no hay casos con versión.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full text-[0.8125rem]">
              <thead><tr className="border-b border-border text-left text-xs text-muted-foreground"><th className="pb-2 font-medium">Flujo</th><th className="pb-2 font-medium">Versión</th><th className="pb-2 text-right font-medium">Casos</th><th className="pb-2 text-right font-medium">Sin observaciones</th><th className="pb-2 text-right font-medium">Hallazgos por caso</th><th className="pb-2 text-right font-medium">Tiempo a decisión</th></tr></thead>
              <tbody>
                {m.versions.map((v) => (
                  <tr key={`${v.flow}-${v.version}`} className="border-b border-border/60">
                    <td className="max-w-[220px] truncate py-2 pr-3">{v.flow}</td>
                    <td className="py-2">v{v.version}</td>
                    <td className="py-2 text-right tabular-nums">{num(v.cases)}</td>
                    <td className="py-2 text-right tabular-nums">{v.cleanPct === null ? "—" : `${v.cleanPct} %`}</td>
                    <td className="py-2 text-right tabular-nums">{v.findings.toLocaleString("es-MX")}</td>
                    <td className="py-2 text-right tabular-nums">{hours(v.decisionHours)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Referencias del Archivo sin confirmar" aside={m.references.missing + m.references.review ? `${num(m.references.missing)} sin localizar · ${num(m.references.review)} por revisar` : undefined}>
        {m.references.list.length === 0 ? <Empty>No hay referencias pendientes.</Empty> : (
          <>
            <ul className="divide-y divide-border">
              {m.references.list.map((r) => (
                <li key={r.id} className="grid gap-1 py-2 text-[13px] sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-4">
                  <span className="truncate"><b className="font-medium">{r.code}</b> <span className="text-muted-foreground">en {r.document}, p. {r.page}</span></span>
                  <span className="text-xs text-muted-foreground">{REF_STATUS[r.status] ?? r.status}</span>
                </li>
              ))}
            </ul>
            <Link href="/contracts/archive" className="text-xs font-semibold text-link hover:underline">Revisar en el Archivo</Link>
          </>
        )}
      </Panel>
    </div>
  );
}
