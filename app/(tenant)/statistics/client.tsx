"use client";

import { useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";
import { cn } from "@/lib/utils";
import type { DayRow } from "./page";

interface ExpenseStats {
  totalSynced: string;
  reportsBystatus: Record<string, number>;
  submitterCount: number;
}

interface Props {
  rows: DayRow[];
  expenseStats?: ExpenseStats | null;
}

const EXPENSE_STATUS_LABELS: Record<string, string> = {
  draft:        "Borrador",
  submitted:    "Enviado",
  under_review: "En revisión",
  approved:     "Aprobado",
  rejected:     "Rechazado",
  syncing:      "Sincronizando",
  synced:       "En NetSuite",
  exception:    "Error",
};

// Design system exact values — recharts fill= is an SVG attribute, not a CSS property,
// so CSS custom properties don't resolve there. Use the raw oklch values.
const COLOR = {
  invoice:     "oklch(0.48 0.15 182)",   // --primary (teal)
  po:          "oklch(0.24 0.11 240)",   // --chart-5 (navy)
  xml:         "oklch(0.62 0.16 85)",    // --chart-3 (ámbar)
  error:       "oklch(0.50 0.20 25)",    // --destructive (carmesí)
};

function shortDate(dateStr: string): string {
  const [, m, d] = dateStr.split("-");
  return `${parseInt(d)}/${parseInt(m)}`;
}

const TOOLTIP_STYLE = {
  background:   "var(--card)",
  border:       "1px solid var(--border)",
  borderRadius: "8px",
  fontSize:     "11px",
  color:        "var(--foreground)",
  boxShadow:    "0 4px 16px oklch(0.18 0.015 258 / 0.08)",
};

export function StatisticsClient({ rows, expenseStats }: Props) {
  const totals = useMemo(() => rows.reduce(
    (acc, r) => ({
      docs:     acc.docs     + r.docsProcessed,
      invoice:  acc.invoice  + r.docsInvoice,
      po:       acc.po       + r.docsPo,
      xml:      acc.xml      + r.docsXml,
      primary:  acc.primary  + r.aiPrimaryCalls,
      fallback: acc.fallback + r.aiFallbackCalls,
      errors:   acc.errors   + r.errors,
      amount:   acc.amount   + parseFloat(r.totalAmount || "0"),
    }),
    { docs: 0, invoice: 0, po: 0, xml: 0, primary: 0, fallback: 0, errors: 0, amount: 0 }
  ), [rows]);

  const fallbackRate = totals.primary > 0
    ? Math.round((totals.fallback / totals.primary) * 100)
    : 0;

  const errorRate = totals.docs > 0
    ? Math.round((totals.errors / totals.docs) * 100)
    : 0;

  const chartData = rows.map(r => ({
    date:     shortDate(r.date),
    Facturas: r.docsInvoice,
    OC:       r.docsPo,
    CFDI:     r.docsXml,
    Errores:  r.errors,
  }));

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Topbar */}
      <div className="h-14 border-b border-border px-6 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-sm font-semibold tracking-[-0.01em] text-foreground">Estadísticas</h1>
          <p className="text-xs text-muted-foreground">Últimos 30 días de actividad</p>
        </div>
      </div>

      {/* Metric strip */}
      <div className="grid grid-cols-4 border-b border-border shrink-0">
        <div className="px-6 py-5 border-r border-border">
          <p className="text-[0.6875rem] font-medium text-muted-foreground uppercase tracking-[0.06em]">
            Docs procesados
          </p>
          <p className="text-[1.5rem] font-semibold tracking-[-0.02em] tabular-nums text-foreground mt-2">
            {totals.docs.toLocaleString("es-MX")}
          </p>
          <p className="text-[0.6875rem] text-muted-foreground mt-1">en 30 días</p>
        </div>

        <div className="px-6 py-5 border-r border-border">
          <p className="text-[0.6875rem] font-medium text-muted-foreground uppercase tracking-[0.06em]">
            Monto total
          </p>
          <p className="text-[1.5rem] font-semibold tracking-[-0.02em] tabular-nums text-foreground mt-2">
            ${totals.amount.toLocaleString("es-MX", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
          </p>
          <p className="text-[0.6875rem] text-muted-foreground mt-1">documentado</p>
        </div>

        <div className="px-6 py-5 border-r border-border">
          <p className="text-[0.6875rem] font-medium text-muted-foreground uppercase tracking-[0.06em]">
            Respaldo IA
          </p>
          <p className={cn(
            "text-[1.5rem] font-semibold tracking-[-0.02em] tabular-nums mt-2",
            fallbackRate > 20 ? "text-warning" : "text-foreground"
          )}>
            {fallbackRate}%
          </p>
          <p className="text-[0.6875rem] text-muted-foreground mt-1">del período</p>
        </div>

        <div className="px-6 py-5">
          <p className="text-[0.6875rem] font-medium text-muted-foreground uppercase tracking-[0.06em]">
            Tasa de error
          </p>
          <p className={cn(
            "text-[1.5rem] font-semibold tracking-[-0.02em] tabular-nums mt-2",
            errorRate > 5 ? "text-destructive" : "text-foreground"
          )}>
            {errorRate}%
          </p>
          <p className="text-[0.6875rem] text-muted-foreground mt-1">de documentos</p>
        </div>
      </div>

      {/* Charts */}
      <div className="flex-1 p-6 space-y-5 overflow-auto">
        {rows.length === 0 ? (
          <div className="py-20 flex flex-col items-center justify-center text-center">
            <p className="text-sm font-medium text-foreground">Sin datos de uso</p>
            <p className="text-xs text-muted-foreground mt-1">
              Las estadísticas aparecen una vez que se procesen documentos
            </p>
          </div>
        ) : (
          <>
            {/* Volume chart */}
            <div className="bg-card rounded-xl border border-border p-5">
              <div className="mb-5">
                <h2 className="text-sm font-semibold tracking-[-0.01em] text-foreground">Volumen diario</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Documentos procesados por tipo</p>
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData} barCategoryGap="38%" barGap={2}>
                  <CartesianGrid
                    vertical={false}
                    stroke="oklch(0.88 0.01 75)"
                    strokeDasharray="3 3"
                  />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: "oklch(0.52 0.02 258)" }}
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "oklch(0.52 0.02 258)" }}
                    tickLine={false}
                    axisLine={false}
                    width={28}
                  />
                  <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "oklch(0.93 0.05 182)", opacity: 0.5 }} />
                  <Legend
                    iconType="square"
                    iconSize={8}
                    wrapperStyle={{ fontSize: 11, color: "oklch(0.52 0.02 258)", paddingTop: 12 }}
                  />
                  <Bar dataKey="Facturas" stackId="a" fill={COLOR.invoice} />
                  <Bar dataKey="OC"       stackId="a" fill={COLOR.po} />
                  <Bar dataKey="CFDI"     stackId="a" fill={COLOR.xml} radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Error chart — only shown when there are errors */}
            {totals.errors > 0 && (
              <div className="bg-card rounded-xl border border-border p-5">
                <div className="mb-5">
                  <h2 className="text-sm font-semibold tracking-[-0.01em] text-foreground">Errores diarios</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">Documentos con fallo de procesamiento</p>
                </div>
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={chartData} barCategoryGap="45%">
                    <CartesianGrid
                      vertical={false}
                      stroke="oklch(0.88 0.01 75)"
                      strokeDasharray="3 3"
                    />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: "oklch(0.52 0.02 258)" }}
                      tickLine={false}
                      axisLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "oklch(0.52 0.02 258)" }}
                      tickLine={false}
                      axisLine={false}
                      width={28}
                    />
                    <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "oklch(0.93 0.05 182)", opacity: 0.5 }} />
                    <Bar dataKey="Errores" fill={COLOR.error} radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Breakdown by type */}
            <div className="bg-card rounded-xl border border-border overflow-hidden">
              <div className="px-5 py-3.5 border-b border-border">
                <h2 className="text-sm font-semibold tracking-[-0.01em] text-foreground">Desglose por tipo</h2>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {["Tipo", "Documentos", "% del total"].map(h => (
                      <th
                        key={h}
                        className="px-5 py-2.5 text-left text-[0.6875rem] font-medium text-muted-foreground uppercase tracking-[0.06em]"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {[
                    { label: "Facturas",           count: totals.invoice },
                    { label: "Órdenes de compra",  count: totals.po },
                    { label: "CFDI",               count: totals.xml },
                  ].map(row => (
                    <tr key={row.label} className="hover:bg-accent/40 transition-colors duration-[120ms]">
                      <td className="px-5 py-3 text-xs font-medium text-foreground">{row.label}</td>
                      <td className="px-5 py-3 text-xs tabular-nums text-foreground">
                        {row.count.toLocaleString("es-MX")}
                      </td>
                      <td className="px-5 py-3 text-xs tabular-nums text-muted-foreground">
                        {totals.docs > 0
                          ? `${Math.round((row.count / totals.docs) * 100)}%`
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* Expense module stats */}
        {expenseStats && (
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
              <h2 className="text-sm font-semibold tracking-[-0.01em] text-foreground">Módulo de Gastos</h2>
              <a
                href="/accounting/expenses"
                className="text-xs text-primary hover:underline"
              >
                Ver todos →
              </a>
            </div>
            <div className="p-5 grid grid-cols-2 gap-4">
              <div>
                <p className="text-[0.6875rem] font-medium text-muted-foreground uppercase tracking-[0.06em]">
                  Total sincronizado a NS
                </p>
                <p className="text-2xl font-semibold tabular-nums text-foreground mt-1">
                  ${Number(expenseStats.totalSynced).toLocaleString("es-MX", { maximumFractionDigits: 0 })}
                </p>
              </div>
              <div className="space-y-1.5">
                {Object.entries(expenseStats.reportsBystatus).map(([status, n]) => (
                  <div key={status} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      {EXPENSE_STATUS_LABELS[status] ?? status}
                    </span>
                    <span className="font-medium tabular-nums text-foreground">{n}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
