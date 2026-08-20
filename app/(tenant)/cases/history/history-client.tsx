"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarDays, FileText, Filter, RotateCcw, Search, Workflow } from "lucide-react";
import { cn } from "@/lib/utils";

export type HistoryCase = {
  id: string;
  title: string;
  status: string;
  flowName: string;
  documentTypes: string[];
  creator: string | null;
  approver: string | null;
  createdAt: string;
  updatedAt: string;
};

const STATUS: Record<string, { label: string; cls: string }> = {
  uploaded: { label: "En cola", cls: "bg-secondary text-muted-foreground" },
  processing: { label: "Procesando", cls: "bg-warning/10 text-warning" },
  review: { label: "En revisión", cls: "bg-warning/10 text-warning" },
  validated: { label: "Validado", cls: "bg-success/10 text-success" },
  generated: { label: "Generado", cls: "bg-success/10 text-success" },
  approved: { label: "Aprobado", cls: "bg-success/10 text-success" },
  rejected: { label: "Rechazado", cls: "bg-destructive/10 text-destructive" },
  failed: { label: "Error", cls: "bg-destructive/10 text-destructive" },
};

const PAGE_SIZE = 25;

function unique(values: Array<string | null>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, "es"));
}

export function CasesHistoryClient({ cases }: { cases: HistoryCase[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [flow, setFlow] = useState("");
  const [documentType, setDocumentType] = useState("");
  const [creator, setCreator] = useState("");
  const [approver, setApprover] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(0);

  const flows = useMemo(() => unique(cases.map((item) => item.flowName)), [cases]);
  const documentTypes = useMemo(() => unique(cases.flatMap((item) => item.documentTypes)), [cases]);
  const creators = useMemo(() => unique(cases.map((item) => item.creator)), [cases]);
  const approvers = useMemo(() => unique(cases.map((item) => item.approver)), [cases]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("es");
    return cases.filter((item) => {
      const date = item.createdAt.slice(0, 10);
      return (!needle || `${item.title} ${item.flowName} ${item.creator ?? ""} ${item.approver ?? ""} ${item.documentTypes.join(" ")}`.toLocaleLowerCase("es").includes(needle))
        && (!status || item.status === status)
        && (!flow || item.flowName === flow)
        && (!documentType || item.documentTypes.includes(documentType))
        && (!creator || item.creator === creator)
        && (!approver || item.approver === approver)
        && (!from || date >= from)
        && (!to || date <= to);
    });
  }, [approver, cases, creator, documentType, flow, from, query, status, to]);
  const safePage = Math.min(page, Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1));
  const displayed = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const filtersActive = Boolean(query || status || flow || documentType || creator || approver || from || to);
  const reset = () => { setQuery(""); setStatus(""); setFlow(""); setDocumentType(""); setCreator(""); setApprover(""); setFrom(""); setTo(""); setPage(0); };
  const setFilter = (setter: (value: string) => void) => (event: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) => { setter(event.target.value); setPage(0); };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-primary">Casos</p>
            <h1 className="mt-1 text-lg font-semibold tracking-[-0.015em] text-foreground">Historial</h1>
            <p className="mt-1 text-xs text-muted-foreground">Consulta todos los casos, quién participó y el flujo que se aplicó.</p>
          </div>
          <Link href="/cases" className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-secondary">Ir a Casos <ArrowRight className="h-3.5 w-3.5" /></Link>
        </div>

        <section aria-label="Filtros del historial" className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-foreground"><Filter className="h-3.5 w-3.5 text-primary" /> Filtrar casos</div>
            {filtersActive && <button type="button" onClick={reset} className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"><RotateCcw className="h-3 w-3" /> Limpiar</button>}
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <label className="relative lg:col-span-2"><span className="sr-only">Buscar</span><Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" /><input value={query} onChange={setFilter(setQuery)} placeholder="Buscar por caso, persona o documento" className="w-full rounded-md border border-border bg-background py-2 pl-8 pr-3 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/60" /></label>
            <FilterSelect label="Estado" value={status} onChange={setFilter(setStatus)} options={Object.entries(STATUS).map(([value, item]) => ({ value, label: item.label }))} />
            <FilterSelect label="Flujo" value={flow} onChange={setFilter(setFlow)} options={flows.map((value) => ({ value, label: value }))} />
            <FilterSelect label="Tipo de documento" value={documentType} onChange={setFilter(setDocumentType)} options={documentTypes.map((value) => ({ value, label: value }))} />
            <FilterSelect label="Creado por" value={creator} onChange={setFilter(setCreator)} options={creators.map((value) => ({ value, label: value }))} />
            <FilterSelect label="Aprobado por" value={approver} onChange={setFilter(setApprover)} options={approvers.map((value) => ({ value, label: value }))} />
            <label className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5"><CalendarDays className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /><span className="text-[11px] text-muted-foreground">Desde</span><input type="date" value={from} onChange={setFilter(setFrom)} className="min-w-0 flex-1 bg-transparent py-2 text-xs text-foreground outline-none" /></label>
            <label className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5"><CalendarDays className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /><span className="text-[11px] text-muted-foreground">Hasta</span><input type="date" value={to} onChange={setFilter(setTo)} className="min-w-0 flex-1 bg-transparent py-2 text-xs text-foreground outline-none" /></label>
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-border bg-card" aria-live="polite">
          <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3"><p className="text-xs font-semibold text-foreground">{filtered.length} de {cases.length} casos</p><p className="text-[11px] text-muted-foreground">Ordenados por última actividad</p></div>
          {displayed.length === 0 ? <div className="px-5 py-14 text-center"><FileText className="mx-auto h-5 w-5 text-muted-foreground" /><p className="mt-3 text-xs font-medium text-foreground">No hay casos con estos filtros</p><p className="mt-1 text-[11px] text-muted-foreground">Ajusta los criterios o limpia la búsqueda.</p></div> : (
            <div className="divide-y divide-border">
              {displayed.map((item) => {
                const current = STATUS[item.status] ?? { label: item.status, cls: "bg-secondary text-muted-foreground" };
                return <Link key={item.id} href={`/cases/${item.id}`} className="group grid gap-3 px-5 py-4 transition-colors hover:bg-secondary/55 sm:grid-cols-[minmax(0,1.5fr)_minmax(10rem,1fr)_auto] sm:items-center">
                  <div className="min-w-0"><p className="truncate text-xs font-semibold text-foreground group-hover:text-primary">{item.title}</p><p className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground"><Workflow className="h-3 w-3 shrink-0" /><span className="truncate">{item.flowName}</span></p></div>
                  <div className="min-w-0 text-[11px] text-muted-foreground"><p className="truncate">Creó: <span className="text-foreground/80">{item.creator ?? "Sin registro"}</span></p><p className="mt-1 truncate">Aprobó: <span className="text-foreground/80">{item.approver ?? "Pendiente"}</span></p><p className="mt-1 truncate">Docs: <span className="text-foreground/80">{item.documentTypes.join(", ") || "Sin clasificar"}</span></p></div>
                  <div className="flex items-center gap-2 sm:flex-col sm:items-end"><span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", current.cls)}>{current.label}</span><time className="text-[10px] tabular-nums text-muted-foreground" dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleString("es-MX")}</time></div>
                </Link>;
              })}
            </div>
          )}
          {filtered.length > PAGE_SIZE && <div className="flex items-center justify-between border-t border-border px-5 py-3"><p className="text-[11px] text-muted-foreground">Página {safePage + 1} de {Math.ceil(filtered.length / PAGE_SIZE)}</p><div className="flex gap-2"><button type="button" disabled={safePage === 0} onClick={() => setPage(safePage - 1)} className="rounded-md border border-border px-2.5 py-1.5 text-[11px] font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-40">Anterior</button><button type="button" disabled={(safePage + 1) * PAGE_SIZE >= filtered.length} onClick={() => setPage(safePage + 1)} className="rounded-md border border-border px-2.5 py-1.5 text-[11px] font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-40">Siguiente</button></div></div>}
        </section>
      </div>
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (event: React.ChangeEvent<HTMLSelectElement>) => void; options: Array<{ value: string; label: string }> }) {
  return <label><span className="sr-only">{label}</span><select value={value} onChange={onChange} className="w-full rounded-md border border-border bg-background px-2.5 py-2 text-xs text-foreground outline-none transition-colors focus:border-primary/60"><option value="">{label}: todos</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}
