"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Search, MoreHorizontal } from "lucide-react";
import { Panel, PanelTitle, Main, Pill, Chip, PRODUCT_SHORT, num, relativeTime, Label, type Tone } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ClientLifecycleDialog } from "@/components/admin/client-lifecycle-dialog";
import { FilterLink } from "@/components/admin/filter-link";

export interface ClientRow {
  id: string; name: string; slug: string; status: string; planId: string; timezone: string; products: string[];
  usage30: { docs: number; cases: number; reports: number }; users: number;
  health: { label: string; tone: Tone; pending: string | null };
  trialEndsAt: string | null; lastActivityAt: string | null; suspensionReason: string | null;
}

const STATUS_LABEL: Record<string, string> = { active: "Activa", trial: "Trial", suspended: "Suspendida", churned: "Cancelada" };
const STATUS_TONE: Record<string, Tone> = { active: "ok", trial: "warn", suspended: "err", churned: "mute" };
const PLAN_LABEL: Record<string, string> = { starter: "Starter", growth: "Growth", enterprise: "Enterprise" };

type StatusFilter = "all" | "attention" | "active" | "trial" | "suspended";
const PAGE_SIZE = 20;

function trialLabel(r: ClientRow): string {
  if (r.status !== "trial" || !r.trialEndsAt) return STATUS_LABEL[r.status] ?? r.status;
  const days = Math.ceil((new Date(r.trialEndsAt).getTime() - Date.now()) / 86_400_000);
  return days <= 0 ? "Trial vencido" : `Trial · ${days} día${days === 1 ? "" : "s"}`;
}

function usageText(r: ClientRow): string {
  const parts: string[] = [];
  if (r.usage30.docs) parts.push(`${num(r.usage30.docs)} docs`);
  if (r.usage30.cases) parts.push(`${num(r.usage30.cases)} casos`);
  if (r.usage30.reports) parts.push(`${num(r.usage30.reports)} informes`);
  return parts.join(" · ") || "sin actividad";
}

export function ClientsView({ rows }: { rows: ClientRow[] }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [product, setProduct] = useState<string | null>(null);
  const [lifecycle, setLifecycle] = useState<ClientRow | null>(null);

  const counts = useMemo(() => {
    const products: Record<string, number> = { ap_automation: 0, contract_intelligence: 0, expense_management: 0 };
    for (const r of rows) for (const p of r.products) products[p] = (products[p] ?? 0) + 1;
    return {
      all: rows.length,
      attention: rows.filter((r) => r.health.tone === "warn" || r.health.tone === "err").length,
      active: rows.filter((r) => r.status === "active").length,
      trial: rows.filter((r) => r.status === "trial").length,
      suspended: rows.filter((r) => r.status === "suspended").length,
      products,
    };
  }, [rows]);

  const filtered = rows.filter((r) => {
    if (search) {
      const q = search.toLowerCase();
      if (!r.name.toLowerCase().includes(q) && !r.slug.includes(q)) return false;
    }
    if (status === "attention" && !(r.health.tone === "warn" || r.health.tone === "err")) return false;
    if (status !== "all" && status !== "attention" && r.status !== status) return false;
    if (product && !r.products.includes(product)) return false;
    return true;
  });

  const maxUsage = Math.max(1, ...rows.map((r) => r.usage30.docs + r.usage30.cases + r.usage30.reports));

  // The page is remembered together with the filters it was chosen under, so
  // changing a filter lands on page 1 without an effect.
  const filterKey = `${search}|${status}|${product ?? ""}`;
  const [paging, setPaging] = useState({ key: filterKey, page: 1 });
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = paging.key === filterKey ? Math.min(paging.page, pageCount) : 1;
  const setPage = (p: number) => setPaging({ key: filterKey, page: Math.max(1, Math.min(pageCount, p)) });
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const first = filtered.length ? (page - 1) * PAGE_SIZE + 1 : 0;
  const last = Math.min(filtered.length, page * PAGE_SIZE);

  return (
    <>
      <Panel>
        <PanelTitle title="Clientes" subtitle={`${rows.length} organización${rows.length === 1 ? "" : "es"}`} />
        <label className="relative block">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nombre o slug" aria-label="Buscar organización"
            className="w-full text-[13px] pl-8 pr-3 py-2 rounded-lg border border-border bg-background" />
        </label>
        <div className="flex flex-col gap-0.5">
          <div className="px-2.5 mb-1.5"><Label>Estado</Label></div>
          <FilterLink active={status === "all"} onClick={() => setStatus("all")} count={counts.all}>Todas</FilterLink>
          <FilterLink active={status === "attention"} onClick={() => setStatus("attention")} count={counts.attention}>Con pendientes</FilterLink>
          <FilterLink active={status === "active"} onClick={() => setStatus("active")} count={counts.active}>Activas</FilterLink>
          <FilterLink active={status === "trial"} onClick={() => setStatus("trial")} count={counts.trial}>En trial</FilterLink>
          <FilterLink active={status === "suspended"} onClick={() => setStatus("suspended")} count={counts.suspended}>Suspendidas</FilterLink>
        </div>
        <div className="flex flex-col gap-0.5">
          <div className="px-2.5 mb-1.5"><Label>Producto</Label></div>
          {(["ap_automation", "contract_intelligence", "expense_management"] as const).map((p) => (
            <FilterLink key={p} active={product === p} onClick={() => setProduct(product === p ? null : p)} count={counts.products[p]}>
              {p === "ap_automation" ? "AP Automation" : p === "contract_intelligence" ? "Contract Intelligence" : "Expense Management"}
            </FilterLink>
          ))}
        </div>
        <div className="mt-auto">
          <Button nativeButton={false} render={<Link href="/admin/clients/new" />} className="w-full">Nueva organización</Button>
        </div>
      </Panel>

      <Main width="max-w-[1280px]">
        <div className="flex items-baseline justify-between gap-4 -mb-6 text-xs text-muted-foreground">
          <span>{filtered.length === rows.length ? `${rows.length} organizaciones` : `${filtered.length} de ${rows.length} organizaciones`}{filtered.length > PAGE_SIZE ? ` · ${first}–${last}` : ""} · ordenadas por última actividad</span>
          <span><strong className="text-foreground font-medium">Salud</strong> = usuarios + ERP (si aplica) + catálogo + primer documento o caso</span>
        </div>
        {rows.length === 0 ? (
          <div className="border-t border-foreground pt-6 text-sm text-muted-foreground">
            Todavía no hay organizaciones. <Link href="/admin/clients/new" className="text-primary">Crea la primera</Link>.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-foreground">
                  {["Organización", "Productos", "Estado", "Uso 30 días", "Salud", "Último acceso", ""].map((h, i) => (
                    <th key={i} className="px-3 py-2.5 text-left text-[11px] font-medium tracking-[0.06em] uppercase text-muted-foreground whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {pageRows.map((r) => {
                  const total = r.usage30.docs + r.usage30.cases + r.usage30.reports;
                  return (
                    <tr key={r.id} className="hover:bg-card transition-colors">
                      <td className="px-3 py-3.5">
                        <Link href={`/admin/clients/${r.id}`} className="font-semibold hover:text-primary">{r.name}</Link>
                        <div className="text-xs text-muted-foreground">{r.slug} · {PLAN_LABEL[r.planId] ?? r.planId}</div>
                      </td>
                      <td className="px-3 py-3.5"><div className="flex gap-1 flex-wrap">{r.products.map((p) => <Chip key={p}>{PRODUCT_SHORT[p] ?? p}</Chip>)}</div></td>
                      <td className="px-3 py-3.5"><Pill tone={STATUS_TONE[r.status] ?? "mute"}>{trialLabel(r)}</Pill></td>
                      <td className="px-3 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <span className="block w-[90px] h-1 rounded bg-secondary overflow-hidden"><span className="block h-full bg-primary rounded" style={{ width: `${Math.round((total / maxUsage) * 100)}%` }} /></span>
                          <span className={cn("text-xs tabular-nums", !total && "text-muted-foreground")}>{usageText(r)}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3.5"><Pill tone={r.health.tone}>{r.health.label}</Pill></td>
                      <td className="px-3 py-3.5 text-xs text-muted-foreground tabular-nums">{relativeTime(r.lastActivityAt)}</td>
                      <td className="px-1 py-3.5 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Acciones para ${r.name}`} />}>
                            <MoreHorizontal />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-56">
                            <DropdownMenuItem render={<Link href={`/admin/clients/${r.id}`} />}>Abrir expediente</DropdownMenuItem>
                            <DropdownMenuItem render={<Link href={`/admin/clients/${r.id}/erp`} />}>Conexión ERP</DropdownMenuItem>
                            <DropdownMenuItem render={<Link href={`/admin/clients/${r.id}/users`} />}>Usuarios</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => setLifecycle(r)} className={r.status === "suspended" ? "" : "text-[oklch(0.50_0.14_80)]"}>
                              {r.status === "suspended" ? "Restablecer acceso" : "Suspender acceso"}
                            </DropdownMenuItem>
                            <DropdownMenuItem variant="destructive" onClick={() => setLifecycle(r)}>Eliminar organización…</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={7} className="px-3 py-10 text-center text-sm text-muted-foreground">Sin resultados con esos filtros.</td></tr>
                )}
              </tbody>
            </table>
            {pageCount > 1 && (
              <nav aria-label="Paginación" className="-mt-4 flex items-center justify-between gap-4 border-t border-foreground pt-3 text-xs text-muted-foreground">
                <span>Página {page} de {pageCount} · {first}–{last} de {filtered.length}</span>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>Anterior</Button>
                  {pageCount <= 7 && Array.from({ length: pageCount }, (_, i) => i + 1).map((p) => (
                    <button key={p} type="button" onClick={() => setPage(p)} aria-current={p === page ? "page" : undefined}
                      className={cn("min-w-7 h-7 px-1.5 rounded-md text-xs tabular-nums transition-colors", p === page ? "bg-foreground text-background font-medium" : "hover:bg-secondary text-foreground")}>
                      {p}
                    </button>
                  ))}
                  <Button variant="ghost" size="sm" disabled={page === pageCount} onClick={() => setPage(page + 1)}>Siguiente</Button>
                </div>
              </nav>
            )}
          </div>
        )}
      </Main>

      {lifecycle && (
        <ClientLifecycleDialog open onClose={() => setLifecycle(null)} org={lifecycle} />
      )}
    </>
  );
}
