"use client";

import { useMemo, useState } from "react";
import { BarChart3, CalendarDays, ChevronDown, Clock3, Files, Filter, ShieldCheck, TriangleAlert } from "lucide-react";
import { FlowBars, SignerDonut, ThroughputArea } from "./charts";

type CaseItem = { id: string; createdAt: string; updatedAt: string; status: string; flowId: string | null };
type ValidationItem = { caseId: string; ok: boolean | null; severity: string };

const DONE = new Set(["validated", "generated", "approved"]);
const STATUS: Record<string, string> = {
  uploaded: "En cola", processing: "Procesando", review: "En revisión", validated: "Validado",
  generated: "Generado", approved: "Aprobado", rejected: "Rechazado", failed: "Error",
};
const PERIODS = [
  { value: "7", label: "Últimos 7 días" }, { value: "30", label: "Últimos 30 días" },
  { value: "90", label: "Últimos 90 días" }, { value: "all", label: "Todo el historial" },
];
const pad = (n: number) => String(n).padStart(2, "0");

function formatDuration(ms: number) {
  if (!ms) return "Sin muestra";
  if (ms < 60_000) return String(Math.round(ms / 1000)) + " s";
  if (ms < 3_600_000) return (ms / 60_000).toFixed(1) + " min";
  return (ms / 3_600_000).toFixed(1) + " h";
}

function countBy(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n).slice(0, 8);
}

export function ContractMetricsClient({ referenceDate, cases, documents, validations, flows }: {
  referenceDate: string;
  cases: CaseItem[];
  documents: Array<{ caseId: string; type: string }>;
  validations: ValidationItem[];
  flows: Array<{ id: string; name: string }>;
}) {
  const [period, setPeriod] = useState("30");
  const [flowId, setFlowId] = useState("");
  const [status, setStatus] = useState("");
  const flowNames = useMemo(() => new Map(flows.map((flow) => [flow.id, flow.name])), [flows]);
  const filtered = useMemo(() => {
    const dayCount = period === "all" ? null : Number(period);
    const cutoff = dayCount ? new Date(new Date(referenceDate).getTime() - (dayCount - 1) * 86_400_000) : null;
    if (cutoff) cutoff.setHours(0, 0, 0, 0);
    return cases.filter((item) => (!cutoff || new Date(item.createdAt) >= cutoff) && (!flowId || item.flowId === flowId) && (!status || item.status === status));
  }, [cases, flowId, period, referenceDate, status]);
  const selectedIds = useMemo(() => new Set(filtered.map((item) => item.id)), [filtered]);
  const selectedDocs = useMemo(() => documents.filter((item) => selectedIds.has(item.caseId)), [documents, selectedIds]);
  const selectedValidations = useMemo(() => validations.filter((item) => selectedIds.has(item.caseId)), [selectedIds, validations]);
  const finished = filtered.filter((item) => DONE.has(item.status));
  const durations = finished.map((item) => new Date(item.updatedAt).getTime() - new Date(item.createdAt).getTime()).filter((duration) => duration > 0);
  const avgDuration = durations.length ? durations.reduce((sum, duration) => sum + duration, 0) / durations.length : 0;
  const rules = { correct: 0, review: 0, finding: 0 };
  for (const item of selectedValidations) {
    if (item.ok === true) rules.correct += 1;
    else if (item.ok === false && item.severity === "block") rules.finding += 1;
    else rules.review += 1;
  }

  const timeline = useMemo(() => {
    const days = period === "all" ? 30 : Number(period);
    const start = new Date(referenceDate); start.setDate(start.getDate() - (days - 1)); start.setHours(0, 0, 0, 0);
    const buckets = Array.from({ length: days }, (_, index) => {
      const date = new Date(start); date.setDate(start.getDate() + index);
      const key = String(date.getFullYear()) + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
      return { key, label: pad(date.getDate()) + "/" + pad(date.getMonth() + 1), n: 0 };
    });
    const indexes = new Map(buckets.map((item, index) => [item.key, index]));
    for (const item of filtered) {
      const date = new Date(item.createdAt);
      const index = indexes.get(String(date.getFullYear()) + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()));
      if (index !== undefined) buckets[index].n += 1;
    }
    return buckets;
  }, [filtered, period, referenceDate]);
  const perFlow = useMemo(() => countBy(filtered.map((item) => item.flowId ? flowNames.get(item.flowId) ?? "Flujo eliminado" : "Sin flujo asignado")), [filtered, flowNames]);
  const perType = useMemo(() => countBy(selectedDocs.map((item) => item.type)), [selectedDocs]);
  const outcomeData = [
    { name: "Correctas", value: rules.correct, tone: "ok" as const },
    { name: "Por revisar", value: rules.review, tone: "warn" as const },
    { name: "Con hallazgos", value: rules.finding, tone: "bad" as const },
  ].filter((item) => item.value > 0);
  const latest = filtered.slice().sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).slice(0, 5);
  const total = filtered.length;
  const completionRate = total ? Math.round((finished.length / total) * 100) : 0;
  const docsPerCase = total ? (selectedDocs.length / total).toFixed(1) : "0";
  const flags = rules.finding + rules.review;

  return <div className="flex-1 overflow-y-auto p-6"><div className="mx-auto max-w-6xl space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><p className="text-[11px] font-medium uppercase tracking-[0.08em] text-primary">Contratos</p><h1 className="mt-1 text-lg font-semibold tracking-[-0.015em] text-foreground">Métricas</h1><p className="mt-1 text-xs text-muted-foreground">Volumen, calidad y tiempo de respuesta de los casos procesados.</p></div>
      <p className="text-[11px] text-muted-foreground">Actualizado con cada actividad del caso</p>
    </div>
    <section aria-label="Filtros de métricas" className="flex flex-wrap items-center gap-2 border-y border-border py-3">
      <span className="mr-1 inline-flex items-center gap-1.5 text-xs font-semibold text-foreground"><Filter className="h-3.5 w-3.5 text-primary" /> Alcance</span>
      <Select value={period} onChange={setPeriod} options={PERIODS} label="Periodo" />
      <Select value={flowId} onChange={setFlowId} options={[{ value: "", label: "Todos los flujos" }, ...flows.map((flow) => ({ value: flow.id, label: flow.name }))]} label="Flujo" />
      <Select value={status} onChange={setStatus} options={[{ value: "", label: "Todos los estados" }, ...Object.entries(STATUS).map(([value, label]) => ({ value, label }))]} label="Estado" />
      <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">{total} caso{total === 1 ? "" : "s"} analizado{total === 1 ? "" : "s"}</span>
    </section>
    {total === 0 ? <EmptyMetrics /> : <>
      <section className="grid gap-0 overflow-hidden rounded-xl border border-border bg-card md:grid-cols-4" aria-label="Resumen del alcance">
        <Summary label="Finalizados" value={String(completionRate) + "%"} detail={String(finished.length) + " de " + String(total) + " casos"} Icon={ShieldCheck} tone="text-success" />
        <Summary label="Tiempo de proceso" value={formatDuration(avgDuration)} detail={durations.length ? String(durations.length) + " casos medidos" : "Aún sin muestra"} Icon={Clock3} tone="text-primary" />
        <Summary label="Documentos por caso" value={docsPerCase} detail={String(selectedDocs.length) + " documentos"} Icon={Files} tone="text-primary" />
        <Summary label="Requieren atención" value={String(flags)} detail={String(rules.finding) + " bloqueos · " + String(rules.review) + " por revisar"} Icon={TriangleAlert} tone={flags ? "text-warning" : "text-success"} />
      </section>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(18rem,0.85fr)]">
        <section className="rounded-xl border border-border bg-card p-5"><PanelTitle title="Actividad de casos" subtitle="Casos creados en el periodo seleccionado." Icon={CalendarDays} /><div className="mt-4"><ThroughputArea data={timeline} /></div></section>
        <section className="rounded-xl border border-border bg-card p-5"><PanelTitle title="Resultado de reglas" subtitle="El detalle que necesita atención, no solo un porcentaje." /><div className="mt-4">{outcomeData.length ? <SignerDonut data={outcomeData} /> : <p className="py-8 text-center text-xs text-muted-foreground">Aún no hay reglas ejecutadas.</p>}</div></section>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-5"><PanelTitle title="Uso por flujo" subtitle="Qué proceso está recibiendo más casos." /><div className="mt-4"><FlowBars data={perFlow} /></div></section>
        <section className="rounded-xl border border-border bg-card p-5"><PanelTitle title="Documentos procesados" subtitle="Distribución por tipo documental detectado." /><div className="mt-4"><FlowBars data={perType} /></div></section>
      </div>
      <section className="overflow-hidden rounded-xl border border-border bg-card"><div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3"><div><h2 className="text-sm font-semibold text-foreground">Última actividad</h2><p className="mt-0.5 text-[11px] text-muted-foreground">Los casos más recientes dentro de este alcance.</p></div><span className="text-[11px] text-muted-foreground">{latest.length} visibles</span></div><div className="divide-y divide-border">{latest.map((item) => <div key={item.id} className="grid gap-1 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-4"><p className="text-xs font-medium text-foreground">{item.flowId ? flowNames.get(item.flowId) ?? "Flujo eliminado" : "Sin flujo asignado"}</p><span className="text-[11px] text-muted-foreground">{STATUS[item.status] ?? item.status}</span><time className="text-[11px] tabular-nums text-muted-foreground" dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleString("es-MX")}</time></div>)}</div></section>
    </>}
  </div></div>;
}

function PanelTitle({ title, subtitle, Icon }: { title: string; subtitle: string; Icon?: typeof CalendarDays }) {
  return <div className="flex items-start justify-between gap-3"><div><h2 className="text-sm font-semibold text-foreground">{title}</h2><p className="mt-1 text-[11px] text-muted-foreground">{subtitle}</p></div>{Icon && <Icon className="h-4 w-4 text-muted-foreground" />}</div>;
}

function Summary({ label, value, detail, Icon, tone }: { label: string; value: string; detail: string; Icon: typeof ShieldCheck; tone: string }) {
  return <div className="border-b border-border px-5 py-4 last:border-b-0 md:border-b-0 md:border-r md:last:border-r-0"><div className="flex items-center justify-between gap-3"><p className="text-[10px] font-medium uppercase tracking-[0.07em] text-muted-foreground">{label}</p><Icon className={"h-3.5 w-3.5 " + tone} /></div><p className="mt-2 text-lg font-semibold tracking-[-0.02em] tabular-nums text-foreground">{value}</p><p className="mt-1 text-[11px] text-muted-foreground">{detail}</p></div>;
}

function EmptyMetrics() {
  return <div className="border border-border bg-card px-5 py-14 text-center"><BarChart3 className="mx-auto h-5 w-5 text-muted-foreground" /><p className="mt-3 text-sm font-semibold text-foreground">No hay actividad en este alcance</p><p className="mt-1 text-xs text-muted-foreground">Cambia los filtros o procesa nuevos casos para ver métricas.</p></div>;
}

function Select({ value, onChange, options, label }: { value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }>; label: string }) {
  return <label className="relative"><span className="sr-only">{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className="appearance-none rounded-md border border-border bg-card py-1.5 pl-2.5 pr-7 text-xs text-foreground outline-none transition-colors hover:bg-secondary focus:border-primary/60">{options.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select><ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" /></label>;
}
