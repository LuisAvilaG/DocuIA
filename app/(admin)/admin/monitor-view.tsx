"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { MonitorData, MonitorRow } from "@/lib/admin/monitor";
import { Panel, PanelTitle, Kv, Main, Pill, num, relativeTime, Label } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";

const REFRESH_MS = 60_000;

function Spark({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  return (
    <span className="inline-flex items-end gap-[2px] h-[18px]" aria-hidden="true">
      {values.map((v, i) => (
        <i key={i} className="block w-1 rounded-[1px] bg-primary/80" style={{ height: `${Math.max(2, Math.round((v / max) * 18))}px`, opacity: v ? 1 : 0.35 }} />
      ))}
    </span>
  );
}

function Dot({ tone }: { tone: "ok" | "warn" | "err" }) {
  const c = tone === "ok" ? "bg-success" : tone === "warn" ? "bg-[oklch(0.70_0.14_80)]" : "bg-destructive";
  return <span className={cn("inline-block w-2 h-2 rounded-full mr-2 align-middle", c)} />;
}

export function MonitorView({ initial }: { initial: MonitorData | null }) {
  const [data, setData] = useState<MonitorData | null>(initial);
  const [error, setError] = useState<string | null>(initial ? null : "No se pudo calcular el monitor.");
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    setRefreshing(true);
    try {
      const res = await fetch("/api/admin/metrics/today", { cache: "no-store" });
      if (!res.ok) throw new Error();
      setData(await res.json());
      setError(null);
    } catch {
      setError("No se pudo actualizar el monitor.");
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    const id = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, REFRESH_MS);
    return () => window.clearInterval(id);
  }, []);

  const t = data?.totals;
  const now = new Date();

  return (
    <>
      <Panel>
        <PanelTitle
          avatar={<div className="w-9 h-9 rounded-[10px] flex items-center justify-center text-sm font-bold" style={{ backgroundColor: "oklch(0.22 0.10 240)", color: "oklch(0.65 0.14 182)" }}>D</div>}
          title="Hoy"
          subtitle={now.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" }) + (data ? ` · ${new Date(data.generatedAt).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}` : "")}
        />
        {t && (
          <div>
            <Kv label="Procesado hoy">{num(t.docsToday)} documentos · {num(t.casesToday)} casos · {num(t.reportsToday)} informes</Kv>
            <Kv label="En revisión">{num(t.inReview)} documentos · {num(t.approvals)} aprobaciones</Kv>
            <Kv label="Errores">{t.errorsToday === 0 ? "ninguno" : `${num(t.errorsToday)} hoy`}</Kv>
            <Kv label="Fallback de IA">{t.fallbackPct === null ? "sin datos" : `${t.fallbackPct} %`}{t.outliers ? ` · ${t.outliers} cliente${t.outliers === 1 ? "" : "s"} fuera de rango` : ""}</Kv>
            <Kv label="Organizaciones">{num(t.orgs)} · {t.active} activas · {t.trial} en trial{t.suspended ? ` · ${t.suspended} suspendida${t.suspended === 1 ? "" : "s"}` : ""}</Kv>
          </div>
        )}
        {data && data.system.length > 0 && (
          <div>
            <Label>Sistema</Label>
            <ul className="mt-2 flex flex-col gap-2 text-[13px]">
              {data.system.map((s) => (
                <li key={s.label}><Dot tone={s.tone} />{s.label} · <span className="text-muted-foreground">{s.detail}</span></li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-auto">
          <Button nativeButton={false} render={<Link href="/admin/clients/new" />} className="w-full">Nueva organización</Button>
        </div>
      </Panel>

      <Main width="max-w-[1280px]">
        <div className="flex items-baseline justify-between gap-4 -mb-6">
          <h2 className="text-[13px] font-semibold">Actividad por cliente, hoy</h2>
          <span className="text-xs text-muted-foreground">
            {refreshing ? "actualizando…" : "se actualiza cada minuto"}{data ? ` · ${data.rows.length} con actividad` : ""}
          </span>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {data && data.rows.length === 0 && !error && (
          <p className="text-sm text-muted-foreground border-t border-foreground pt-4">Ningún cliente ha procesado nada todavía hoy.</p>
        )}
        {data && data.rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-foreground">
                  {[["Cliente", ""], ["Últimas 12 h", ""], ["Docs", "r"], ["Casos", "r"], ["Revisión", "r"], ["Fallback", "r"], ["Estado", ""]].map(([h, align]) => (
                    <th key={h} className={cn("px-3 py-2.5 text-[11px] font-medium tracking-[0.06em] uppercase text-muted-foreground whitespace-nowrap", align === "r" ? "text-right" : "text-left")}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {data.rows.map((r: MonitorRow) => (
                  <tr key={r.id} className="hover:bg-card transition-colors">
                    <td className="px-3 py-3"><Link href={r.href} className="font-semibold hover:text-primary">{r.name}</Link><div className="text-xs text-muted-foreground">{relativeTime(r.lastActivityAt)}</div></td>
                    <td className="px-3 py-3"><Spark values={r.spark} /></td>
                    <td className="px-3 py-3 text-right tabular-nums">{r.docsToday || "—"}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{r.casesToday || (r.reportsToday ? `${r.reportsToday} inf.` : "—")}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{r.inReview || "—"}</td>
                    <td className={cn("px-3 py-3 text-right tabular-nums", r.fallbackPct !== null && r.fallbackPct >= 25 && "text-[oklch(0.50_0.14_80)] font-medium")}>{r.fallbackPct === null ? "—" : `${r.fallbackPct} %`}</td>
                    <td className="px-3 py-3">{r.status.tone === "ok" ? <span className="text-xs text-muted-foreground">Normal</span> : <Pill tone={r.status.tone}>{r.status.label}</Pill>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && (
          <p className="text-xs text-muted-foreground -mt-6">
            {data.idle} cliente{data.idle === 1 ? "" : "s"} sin actividad hoy. <Link href="/admin/clients" className="text-primary">Ver todos</Link>
          </p>
        )}
      </Main>
    </>
  );
}
