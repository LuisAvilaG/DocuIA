import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth/admin";
import { loadAdminAiMetrics, type AdminAiMetrics } from "@/lib/admin/ai-metrics";
import { Main, Notice, Pill, SectionTitle, num } from "@/components/admin/ui";
import { AI_MODELS } from "@/lib/ai/provider";

const PERIODS = [7, 30, 90] as const;
const SOURCE: Record<string, string> = { facturas: "Facturas", contratos: "Contratos", gastos: "Gastos", archivo: "Archivo", otro: "Otro" };
const usd = (v: number) => v < 0.01 && v > 0 ? "< $0.01" : v.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: v < 10 ? 3 : 2 });
const modelName = (id: string | null) => (id ? AI_MODELS.find((m) => m.id === id)?.label ?? id : "—");
const tokens = (v: number) => v >= 1_000_000 ? `${(v / 1_000_000).toLocaleString("es-MX", { maximumFractionDigits: 1 })} M` : v >= 1000 ? `${Math.round(v / 1000).toLocaleString("es-MX")} mil` : num(v);

function Bar({ pct, tone = "bg-primary" }: { pct: number; tone?: string }) {
  return <span className="block h-1.5 w-full overflow-hidden rounded bg-secondary"><span className={`block h-full rounded ${tone}`} style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} /></span>;
}

export default async function AdminMetricsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  if ((await requireAdminSession()).error) redirect("/admin/login");
  const { days: raw } = await searchParams;
  const days = PERIODS.find((d) => String(d) === raw) ?? 30;
  let m: AdminAiMetrics | null = null;
  try { m = await loadAdminAiMetrics(days); } catch (err) { console.error("[admin/metrics]", err); }

  const maxCost = Math.max(...(m?.clients.map((c) => c.cost) ?? [0]), 0.000001);
  const sinceLabel = m?.since ? new Date(m.since).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" }) : null;

  return (
    <Main>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Métricas</h1>
          <p className="mt-1 text-[15px] text-muted-foreground">Costo de IA, calidad de lectura y errores por cliente. Los clientes no ven el costo.</p>
        </div>
        <nav aria-label="Periodo" className="flex gap-1 rounded-lg border border-border p-1 text-[13px]">
          {PERIODS.map((d) => (
            <Link key={d} href={`/admin/metrics?days=${d}`} aria-current={d === days ? "page" : undefined}
              className={`rounded-md px-3 py-1 ${d === days ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}>
              {d} días
            </Link>
          ))}
        </nav>
      </header>

      {!m ? <Notice tone="err" title="No se pudieron calcular las métricas">Intenta recargar la página.</Notice> : (
        <>
          <section className="flex flex-col gap-4">
            <SectionTitle aside={m.clients.length ? `${usd(m.totalCost)} en ${days} días` : undefined}>Costo de IA por cliente</SectionTitle>
            {!sinceLabel ? (
              <p className="text-sm text-muted-foreground">El costo se registra por llamada desde esta versión. Aparecerá aquí con los próximos documentos procesados.</p>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">Estimado con las tarifas de cada modelo, registrado desde el {sinceLabel}. Los lotes cuentan a mitad de precio.</p>
                {m.unpriced.length > 0 && <Notice tone="warn" title="Hay modelos sin tarifa cargada">{m.unpriced.join(", ")} no suman costo. Se agrega en lib/ai/usage.ts.</Notice>}
                {m.clients.length === 0 ? <p className="text-sm text-muted-foreground">Sin llamadas a la IA en el periodo.</p> : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-[13px]">
                      <thead><tr className="border-b border-border text-left text-xs text-muted-foreground"><th className="py-2 font-medium">Cliente</th><th className="w-40 py-2 font-medium">Costo</th><th className="py-2 text-right font-medium">Por documento</th><th className="py-2 text-right font-medium">Llamadas</th><th className="py-2 pl-4 font-medium">Modelo principal</th><th className="py-2 pl-4 font-medium">Dónde</th></tr></thead>
                      <tbody>
                        {m.clients.map((c) => (
                          <tr key={c.id} className="border-b border-border/60">
                            <td className="py-2.5 pr-3"><Link href={`/admin/clients/${c.id}/usage`} className="hover:underline">{c.name}</Link></td>
                            <td className="py-2.5 pr-3"><span className="flex items-center gap-2"><span className="w-16"><Bar pct={(c.cost / maxCost) * 100} /></span><span className="tabular-nums">{usd(c.cost)}</span></span></td>
                            <td className="py-2.5 text-right tabular-nums">{c.costPerDoc === null ? "—" : usd(c.costPerDoc)}</td>
                            <td className="py-2.5 text-right tabular-nums">{num(c.calls)}</td>
                            <td className="py-2.5 pl-4">{modelName(c.topModel)}</td>
                            <td className="py-2.5 pl-4 text-xs text-muted-foreground">{Object.entries(c.sources).sort((a, b) => b[1] - a[1]).map(([s]) => SOURCE[s] ?? s).join(" · ")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {m.byModel.length > 0 && (
                  <table className="w-full max-w-[720px] text-[13px]">
                    <thead><tr className="border-b border-border text-left text-xs text-muted-foreground"><th className="py-2 font-medium">Modelo</th><th className="py-2 text-right font-medium">Llamadas</th><th className="py-2 text-right font-medium">Tokens de entrada</th><th className="py-2 text-right font-medium">De salida</th><th className="py-2 text-right font-medium">Costo</th></tr></thead>
                    <tbody>
                      {m.byModel.map((r) => (
                        <tr key={r.model} className="border-b border-border/60"><td className="py-2">{modelName(r.model)}</td><td className="py-2 text-right tabular-nums">{num(r.calls)}</td><td className="py-2 text-right tabular-nums">{tokens(r.inputTokens)}</td><td className="py-2 text-right tabular-nums">{tokens(r.outputTokens)}</td><td className="py-2 text-right tabular-nums">{usd(r.cost)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            )}
          </section>

          <section className="flex flex-col gap-4">
            <SectionTitle aside="Documentos difíciles o una conexión con problemas">Segundo modelo y errores por cliente</SectionTitle>
            {m.health.length === 0 ? <p className="text-sm text-muted-foreground">Sin lecturas ni errores en el periodo.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead><tr className="border-b border-border text-left text-xs text-muted-foreground"><th className="py-2 font-medium">Cliente</th><th className="py-2 text-right font-medium">Lecturas</th><th className="w-40 py-2 pl-4 font-medium">Segundo modelo</th><th className="py-2 text-right font-medium">Excepciones</th><th className="py-2 text-right font-medium">Abiertas</th><th className="py-2 text-right font-medium">Rechazos del ERP</th><th className="py-2 text-right font-medium">Casos con error</th></tr></thead>
                  <tbody>
                    {m.health.map((h) => (
                      <tr key={h.id} className="border-b border-border/60">
                        <td className="py-2.5 pr-3"><Link href={`/admin/clients/${h.id}`} className="hover:underline">{h.name}</Link></td>
                        <td className="py-2.5 text-right tabular-nums">{num(h.extractions)}</td>
                        <td className="py-2.5 pl-4">{h.fallbackPct === null ? <span className="text-muted-foreground">—</span> : <span className="flex items-center gap-2"><span className="w-16"><Bar pct={h.fallbackPct} tone={h.fallbackPct >= 25 ? "bg-[#B07C0E]" : "bg-primary"} /></span><span className="tabular-nums">{h.fallbackPct} %</span></span>}</td>
                        <td className="py-2.5 text-right tabular-nums">{num(h.exceptions)}</td>
                        <td className="py-2.5 text-right tabular-nums">{h.open ? <Pill tone="warn">{num(h.open)}</Pill> : "—"}</td>
                        <td className="py-2.5 text-right tabular-nums">{h.erpErrors ? <Pill tone="err">{num(h.erpErrors)}</Pill> : "—"}</td>
                        <td className="py-2.5 text-right tabular-nums">{h.failedCases ? <Pill tone="err">{num(h.failedCases)}</Pill> : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="flex flex-col gap-4">
            <SectionTitle aside={m.qa.length ? `${m.qa.length} cliente${m.qa.length === 1 ? "" : "s"}` : undefined}>Clientes en modo QA</SectionTitle>
            {m.qa.length === 0 ? <p className="text-sm text-muted-foreground">Ningún cliente está probando en modo QA.</p> : (
              <ul className="flex flex-col">
                {m.qa.map((q) => (
                  <li key={q.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 py-2.5 text-[13px]">
                    <Link href={`/admin/clients/${q.id}/features`} className="font-medium hover:underline">{q.name}</Link>
                    <span className="text-muted-foreground">{q.appliesTo} · hasta el {new Date(`${q.expiresOn}T12:00:00`).toLocaleDateString("es-MX", { day: "numeric", month: "long" })}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <p className="text-xs text-muted-foreground">Documentos, casos y usuarios activos por día están en el <Link href="/admin" className="text-link hover:underline">Resumen</Link> y en el uso de cada cliente.</p>
        </>
      )}
    </Main>
  );
}
