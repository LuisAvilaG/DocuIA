"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, CheckCircle2, ClipboardCheck, FileText, Filter, ShieldAlert, ShieldCheck, ShieldX, XCircle } from "lucide-react";
import { DecisionDialog, type CaseDecisionAction } from "../components/decision-dialog";

export interface PendingCase {
  id: string;
  title: string;
  createdAt: string;
  verdict: "ok" | "warn" | "block" | null;
  validations: number;
  blockerCount: number;
  warningCount: number;
  blockerSummary: string[];
  flowName: string | null;
  documentCount: number;
  createdBy: string | null;
}

const VERDICT = {
  ok: { Icon: ShieldCheck, cls: "bg-success/10 text-success", text: "Sin observaciones" },
  warn: { Icon: ShieldAlert, cls: "bg-warning/10 text-warning", text: "Con advertencias" },
  block: { Icon: ShieldX, cls: "bg-destructive/10 text-destructive", text: "Con bloqueos" },
};

type FilterTab = "all" | "ready" | "blocked";

export function ApprovalsClient({ cases, allowOverride }: { cases: PendingCase[]; allowOverride: boolean }) {
  const router = useRouter();
  const [tab, setTab] = useState<FilterTab>("all");
  const [query, setQuery] = useState("");
  const [flow, setFlow] = useState("all");
  const [dialog, setDialog] = useState<{ item: PendingCase; action: CaseDecisionAction } | null>(null);
  const flows = useMemo(() => [...new Set(cases.map((item) => item.flowName).filter((name): name is string => Boolean(name)))].sort(), [cases]);
  const counts = useMemo(() => ({
    all: cases.length,
    ready: cases.filter((item) => item.blockerCount === 0).length,
    blocked: cases.filter((item) => item.blockerCount > 0).length,
  }), [cases]);
  const filtered = useMemo(() => cases.filter((item) => {
    const matchesTab = tab === "all" || (tab === "ready" ? item.blockerCount === 0 : item.blockerCount > 0);
    const matchesFlow = flow === "all" || item.flowName === flow;
    const haystack = `${item.title} ${item.createdBy ?? ""} ${item.flowName ?? ""} ${item.blockerSummary.join(" ")}`.toLowerCase();
    return matchesTab && matchesFlow && haystack.includes(query.trim().toLowerCase());
  }), [cases, flow, query, tab]);

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.06em] text-primary">Control de decisiones</p>
            <h1 className="mt-1 text-lg font-semibold tracking-[-0.01em] text-foreground">Aprobaciones</h1>
            <p className="mt-1 text-xs text-muted-foreground">Solo aparecen casos cuya validación ya terminó. La generación se habilita después de aprobar.</p>
          </div>
          <Link href="/cases/history" className="inline-flex h-9 items-center justify-center rounded-lg border border-border px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">Ver historial de casos</Link>
        </header>

        <section aria-label="Estado de la bandeja" className="border-y border-border py-3">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
            <span className="font-semibold text-foreground"><span className="tabular-nums">{counts.all}</span> pendientes</span>
            <span className="text-success"><span className="font-semibold tabular-nums">{counts.ready}</span> listos para aprobar</span>
            <span className="text-destructive"><span className="font-semibold tabular-nums">{counts.blocked}</span> con bloqueantes</span>
          </div>
        </section>

        <section className="space-y-3" aria-label="Filtros de aprobaciones">
          <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Estado de validación">
            {(["all", "ready", "blocked"] as const).map((item) => {
              const label = item === "all" ? "Todos" : item === "ready" ? "Listos" : "Con bloqueos";
              const active = tab === item;
              return <button key={item} type="button" role="tab" aria-selected={active} onClick={() => setTab(item)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${active ? "bg-primary text-primary-foreground" : "border border-border bg-card text-muted-foreground hover:bg-secondary hover:text-foreground"}`}>
                {label} <span className="ml-1 tabular-nums opacity-75">{counts[item]}</span>
              </button>;
            })}
          </div>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <label className="relative block">
              <span className="sr-only">Buscar casos pendientes</span>
              <Filter className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por caso, flujo, responsable o hallazgo"
                className="h-10 w-full rounded-lg border border-border bg-card py-2 pl-9 pr-3 text-xs text-foreground outline-none placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-primary/15" />
            </label>
            {flows.length > 0 && <label className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs text-muted-foreground">
              <span className="whitespace-nowrap">Flujo</span>
              <select value={flow} onChange={(event) => setFlow(event.target.value)} className="h-9 min-w-36 bg-transparent text-xs text-foreground outline-none">
                <option value="all">Todos los flujos</option>
                {flows.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>}
          </div>
        </section>

        {filtered.length === 0 ? (
          <div className="border border-border bg-card px-6 py-12 text-center">
            <ClipboardCheck className="mx-auto h-5 w-5 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium text-foreground">No hay casos en esta vista</p>
            <p className="mt-1 text-xs text-muted-foreground">Ajusta los filtros o espera a que termine la validación de un caso.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="divide-y divide-border">
              {filtered.map((item) => {
                const verdict = item.verdict ? VERDICT[item.verdict] : null;
                const isBlocked = item.blockerCount > 0;
                return (
                  <article key={item.id} className="grid gap-4 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/cases/${item.id}`} className="text-sm font-semibold text-foreground transition-colors hover:text-primary">{item.title}</Link>
                        {verdict && <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${verdict.cls}`}><verdict.Icon className="h-3 w-3" />{verdict.text}</span>}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                        <span className="inline-flex items-center gap-1"><FileText className="h-3 w-3" />{item.documentCount} documento{item.documentCount === 1 ? "" : "s"}</span>
                        {item.flowName && <span>Flujo: {item.flowName}</span>}
                        {item.createdBy && <span>Subió: {item.createdBy}</span>}
                        <time className="tabular-nums" dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString("es-MX")}</time>
                      </div>
                      {isBlocked ? <p className="mt-2 text-[11px] leading-relaxed text-destructive"><span className="font-medium">{item.blockerCount} bloqueo{item.blockerCount === 1 ? "" : "s"}:</span> {item.blockerSummary.join(" · ")}</p>
                        : item.warningCount > 0 ? <p className="mt-2 text-[11px] text-warning">{item.warningCount} advertencia{item.warningCount === 1 ? "" : "s"}, no bloqueante{item.warningCount === 1 ? "" : "s"}.</p>
                        : <p className="mt-2 text-[11px] text-success">Controles completados sin bloqueos.</p>}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                      {(!isBlocked || allowOverride) && <button type="button" onClick={() => setDialog({ item, action: "approve" })}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-success/15 px-2.5 text-[11px] font-medium text-success transition-colors hover:bg-success/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"><CheckCircle2 className="h-3.5 w-3.5" />{isBlocked ? "Aprobar excepción" : "Aprobar"}</button>}
                      <button type="button" onClick={() => setDialog({ item, action: "reject" })}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-destructive/20 bg-destructive/10 px-2.5 text-[11px] font-medium text-destructive transition-colors hover:bg-destructive/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"><XCircle className="h-3.5 w-3.5" />Rechazar</button>
                      <Link href={`/cases/${item.id}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">Revisar <ArrowRight className="h-3.5 w-3.5" /></Link>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        )}
      </div>
      {dialog && <DecisionDialog caseId={dialog.item.id} caseTitle={dialog.item.title} action={dialog.action} blocked={dialog.item.blockerCount > 0} allowOverride={allowOverride} onClose={() => setDialog(null)} onComplete={() => { setDialog(null); router.refresh(); }} />}
    </div>
  );
}
