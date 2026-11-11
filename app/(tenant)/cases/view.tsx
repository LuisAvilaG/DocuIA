"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { btn, CaseStatusPill, EmptyState, PageFrame, StatusPill, ViewTabs } from "@/components/kit";
import { NewCaseDialog } from "./new-case-dialog";

export type CaseView = "all" | "analyzing" | "decide" | "findings" | "done" | "rejected" | "failed";

export interface CaseListRow {
  id: string; title: string; flowName: string; docs: string[]; status: string;
  tone: "err" | "warn" | null; detail: string | null; owner: string; updatedAt: string;
}

const VIEW_LABEL: Record<CaseView, string> = {
  all: "Todos", analyzing: "Analizando", decide: "Por decidir", findings: "Con hallazgos",
  done: "Aprobados", rejected: "Rechazados", failed: "Con error",
};
const PERIODS = [["30", "Últimos 30 días"], ["90", "Últimos 90 días"], ["365", "Último año"], ["all", "Todo"]] as const;

function ago(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 60) return `hace ${Math.max(1, min)} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  if (d === 1) return "ayer";
  return d < 30 ? `hace ${d} días` : new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}

type Filters = { view: CaseView; q: string; flow: string; period: string; owner: string };

export function CasesView({ rows, counts, total, page, pageSize, filters, flows, owners, canCreate, openNew }: {
  rows: CaseListRow[]; counts: Record<string, number>; total: number; page: number; pageSize: number;
  filters: Filters; flows: { id: string; name: string }[]; owners: { id: string; name: string }[];
  canCreate: boolean; openNew: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();
  const [creating, setCreating] = useState(openNew);
  const [q, setQ] = useState(filters.q);

  const href = (next: Partial<Filters> & { page?: number }) => {
    const f = { ...filters, ...next };
    const p = new URLSearchParams();
    if (f.view !== "all") p.set("view", f.view);
    if (f.q) p.set("q", f.q);
    if (f.flow) p.set("flow", f.flow);
    if (f.period !== "90") p.set("period", f.period);
    if (f.owner) p.set("owner", f.owner);
    if (next.page && next.page > 1) p.set("page", String(next.page));
    const s = p.toString();
    return s ? `${pathname}?${s}` : pathname;
  };
  const go = (next: Partial<Filters>) => startTransition(() => router.replace(href(next), { scroll: false }));

  useEffect(() => {
    if (q.trim() === filters.q) return;
    const t = setTimeout(() => go({ q: q.trim() }), 350);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  function closeNew() {
    setCreating(false);
    if (openNew) router.replace(href({}), { scroll: false });
  }

  const filtered = Boolean(filters.q || filters.flow || filters.owner || filters.view !== "all");
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const select = "min-h-10 rounded-lg border border-[#D6D2C8] bg-white px-3 text-sm";

  return (
    <PageFrame>
      <header className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.06em] text-link">Contratos</p>
          <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-[-0.025em]">Casos</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{(counts.all ?? 0).toLocaleString("es-MX")} caso{counts.all === 1 ? "" : "s"} en el periodo</p>
        </div>
        {canCreate && <button type="button" className={btn("primary")} onClick={() => setCreating(true)}>Nuevo caso</button>}
      </header>

      <ViewTabs className="mt-6" items={(Object.keys(VIEW_LABEL) as CaseView[])
        .filter((k) => k === "all" || k === filters.view || (counts[k] ?? 0) > 0)
        .map((k) => ({ key: k, label: VIEW_LABEL[k], count: counts[k] ?? 0, href: href({ view: k }), active: filters.view === k }))} />

      <div role="search" className="mb-4 mt-4.5 flex flex-wrap items-center gap-2.5">
        <label className="relative w-full max-w-[420px] flex-[1_1_280px]">
          <span className="sr-only">Buscar casos</span>
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre del caso"
            className="min-h-10 w-full rounded-lg border border-[#D6D2C8] bg-white pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
        </label>
        {flows.length > 1 && (
          <select aria-label="Flujo" value={filters.flow} onChange={(e) => go({ flow: e.target.value })} className={select}>
            <option value="">Todos los flujos</option>
            {flows.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        )}
        <select aria-label="Periodo" value={filters.period} onChange={(e) => go({ period: e.target.value })} className={select}>
          {PERIODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        {owners.length > 1 && (
          <select aria-label="Responsable" value={filters.owner} onChange={(e) => go({ owner: e.target.value })} className={select}>
            <option value="">Cualquier responsable</option>
            {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState title={filtered ? (filters.q ? `Ningún caso coincide con «${filters.q}»` : "Nada en esta vista") : "Todavía no hay casos"}
          actions={filtered
            ? <button type="button" className={btn("secondary")} onClick={() => { setQ(""); go({ view: "all", q: "", flow: "", owner: "" }); }}>Quitar filtros</button>
            : canCreate ? <button type="button" className={btn("primary")} onClick={() => setCreating(true)}>Nuevo caso</button> : undefined}>
          {filtered ? "Prueba con otra vista, otro periodo o quita los filtros." : "Crea un caso: elige el flujo y sube los documentos que pide."}
        </EmptyState>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full text-[13.5px]">
              <thead>
                <tr className="border-b border-border">
                  {["Caso", "Documentos", "Estado", "Responsable", "Actualizado"].map((h) => (
                    <th key={h} scope="col" className="whitespace-nowrap px-3.5 py-2.5 text-left text-[11.5px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const deciding = r.status === "review" || r.status === "validated";
                  return (
                    <tr key={r.id} className="border-b border-line-soft align-top last:border-0 hover:bg-secondary/30">
                      <td className="max-w-[320px] px-3.5 py-3">
                        <Link href={`/contracts/${r.id}`} className="block truncate font-semibold text-link hover:underline">{r.title}</Link>
                        <small className="text-xs text-muted-foreground">{r.flowName}</small>
                      </td>
                      <td className="px-3.5 py-3">
                        <span className="flex max-w-[260px] flex-wrap gap-1">
                          {r.docs.length ? r.docs.map((d) => <span key={d} className="rounded-md bg-tone-mute-bg px-1.5 py-0.5 text-xs text-foreground/75">{d}</span>) : <span className="text-muted-foreground">—</span>}
                        </span>
                      </td>
                      <td className="max-w-[280px] px-3.5 py-3">
                        {deciding ? <StatusPill tone={r.tone ?? "ok"}>Por decidir</StatusPill> : <CaseStatusPill status={r.status} />}
                        {r.detail && <small className="mt-1 block truncate text-xs text-muted-foreground">{r.detail}</small>}
                      </td>
                      <td className="whitespace-nowrap px-3.5 py-3">{r.owner}</td>
                      <td className="whitespace-nowrap px-3.5 py-3 text-muted-foreground tabular-nums">{ago(r.updatedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <span className="text-[12.5px] tabular-nums text-muted-foreground">Mostrando {from}–{to} de {total.toLocaleString("es-MX")}</span>
            <span className="flex gap-1.5">
              {page > 1 ? <Link href={href({ page: page - 1 })} scroll={false} className={btn("secondary", "sm")}>Anterior</Link> : <span aria-disabled className={btn("secondary", "sm", "pointer-events-none opacity-50")}>Anterior</span>}
              {to < total ? <Link href={href({ page: page + 1 })} scroll={false} className={btn("secondary", "sm")}>Siguiente</Link> : <span aria-disabled className={btn("secondary", "sm", "pointer-events-none opacity-50")}>Siguiente</span>}
            </span>
          </div>
        </>
      )}

      {creating && <NewCaseDialog onClose={closeNew} />}
    </PageFrame>
  );
}
