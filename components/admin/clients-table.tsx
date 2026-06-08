"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

const STATUS_STYLES = {
  active:    "bg-emerald-400/10 text-emerald-400 border-emerald-400/20",
  trial:     "bg-amber-400/10 text-amber-400 border-amber-400/20",
  suspended: "bg-red-400/10 text-red-400 border-red-400/20",
  churned:   "bg-slate-400/10 text-slate-400 border-slate-400/20",
};

const STATUS_LABELS: Record<string, string> = {
  active: "Activo", trial: "Trial", suspended: "Suspendido", churned: "Cancelado",
};

const PLAN_STYLES: Record<string, string> = {
  starter:    "bg-slate-400/10 text-slate-400",
  growth:     "bg-primary/10 text-primary",
  enterprise: "bg-violet-400/10 text-violet-400",
};

function HealthScore({ score }: { score: number }) {
  const color = score >= 75 ? "text-emerald-400" : score >= 50 ? "text-amber-400" : "text-red-400";
  const bg    = score >= 75 ? "bg-emerald-400"   : score >= 50 ? "bg-amber-400"   : "bg-red-400";
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-secondary rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full", bg)} style={{ width: `${score}%` }} />
      </div>
      <span className={cn("text-xs font-medium tabular-nums", color)}>{score}</span>
    </div>
  );
}

export interface ClientRow {
  id: string;
  name: string;
  status: "active" | "trial" | "suspended" | "churned";
  plan: "starter" | "growth" | "enterprise";
  docsThisMonth: number;
  subsidiariesCount: number;
  healthScore: number;
  lastActive: string;
}

interface Props {
  clients: ClientRow[];
}

export function ClientsTable({ clients }: Props) {
  const [search, setSearch]     = useState("");
  const [status, setStatus]     = useState("");
  const [plan, setPlan]         = useState("");

  const filtered = useMemo(() => {
    return clients.filter(c => {
      if (search && !c.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (status && c.status !== status) return false;
      if (plan && c.plan !== plan) return false;
      return true;
    });
  }, [clients, search, status, plan]);

  return (
    <>
      {/* Filters bar */}
      <div className="px-6 py-3 border-b border-border flex items-center gap-3">
        <div className="relative flex-1 max-w-64">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar organización..."
            className="w-full bg-secondary/50 border border-border/60 rounded-lg pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/20"
          />
        </div>
        <select
          value={status}
          onChange={e => setStatus(e.target.value)}
          className="bg-secondary/50 border border-border/60 rounded-lg px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary/60"
        >
          <option value="">Todos los estados</option>
          <option value="active">Activo</option>
          <option value="trial">Trial</option>
          <option value="suspended">Suspendido</option>
          <option value="churned">Cancelado</option>
        </select>
        <select
          value={plan}
          onChange={e => setPlan(e.target.value)}
          className="bg-secondary/50 border border-border/60 rounded-lg px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary/60"
        >
          <option value="">Todos los planes</option>
          <option value="starter">Starter</option>
          <option value="growth">Growth</option>
          <option value="enterprise">Enterprise</option>
        </select>
        {(search || status || plan) && (
          <button
            onClick={() => { setSearch(""); setStatus(""); setPlan(""); }}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors ml-auto"
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <p className="text-sm font-medium text-foreground">
              {clients.length === 0 ? "Sin organizaciones" : "Sin resultados"}
            </p>
            <p className="text-xs text-muted-foreground mt-1 max-w-xs">
              {clients.length === 0
                ? "Las organizaciones que se registren aparecerán aquí"
                : "Prueba con otros filtros"}
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-background border-b border-border z-10">
              <tr>
                {["Organización", "Plan", "Estado", "Docs/mes", "Subsidiarias", "Health score", "Última actividad", ""].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map(c => (
                <tr key={c.id} className="hover:bg-accent/30 transition-colors group">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/clients/${c.id}`}
                      className="font-medium text-foreground hover:text-primary transition-colors"
                    >
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium", PLAN_STYLES[c.plan])}>
                      {c.plan}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border", STATUS_STYLES[c.status])}>
                      {STATUS_LABELS[c.status] ?? c.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-foreground">
                    {c.docsThisMonth.toLocaleString("es-MX")}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-foreground">
                    {c.subsidiariesCount}
                  </td>
                  <td className="px-4 py-3">
                    <HealthScore score={c.healthScore} />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {c.lastActive}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/clients/${c.id}`}
                      className="text-xs text-primary hover:text-primary/80 opacity-0 group-hover:opacity-100 transition-all"
                    >
                      Ver →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
