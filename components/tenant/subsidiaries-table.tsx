"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

interface Row {
  id: string;
  name: string;
  nsSubsidiaryId: string;
  currency: string;
  locale: string;
  isActive: boolean;
}

/** Compact, searchable list of the organization's subsidiaries (read-only). */
export function SubsidiariesTable({ subsidiaries }: { subsidiaries: Row[] }) {
  const [query, setQuery] = useState("");
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...subsidiaries]
      .sort((a, b) => a.name.localeCompare(b.name, "es", { numeric: true }))
      .filter((s) => !q || s.name.toLowerCase().includes(q) || s.nsSubsidiaryId.includes(q));
  }, [subsidiaries, query]);
  const active = subsidiaries.filter((s) => s.isActive).length;

  return (
    <div className="max-w-4xl space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xs text-muted-foreground">
          {subsidiaries.length} subsidiaria{subsidiaries.length === 1 ? "" : "s"} · {active} activa{active === 1 ? "" : "s"}.
          Las credenciales de conexión al ERP las gestiona el administrador de DocuIA.
        </p>
        {subsidiaries.length > 8 && (
          <div className="relative ml-auto w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nombre o ID"
              aria-label="Buscar subsidiaria"
              className="w-full rounded-md border border-border bg-card py-[7px] pl-9 pr-3 text-xs outline-none focus:border-primary"
            />
          </div>
        )}
      </div>
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="max-h-[60vh] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-card border-b border-border">
              <tr className="text-left text-[0.6875rem] uppercase tracking-[0.06em] text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Subsidiaria</th>
                <th className="px-4 py-2.5 font-medium">ID ERP</th>
                <th className="px-4 py-2.5 font-medium">Moneda</th>
                <th className="px-4 py-2.5 font-medium">Locale</th>
                <th className="px-4 py-2.5 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((s) => (
                <tr key={s.id} className="hover:bg-accent/30">
                  <td className="px-4 py-2.5 font-medium text-foreground">{s.name}</td>
                  <td className="px-4 py-2.5 font-mono text-muted-foreground">{s.nsSubsidiaryId}</td>
                  <td className="px-4 py-2.5 text-foreground">{s.currency}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{s.locale}</td>
                  <td className="px-4 py-2.5">
                    <span className={cn("rounded-sm px-2 py-0.5 text-[0.6875rem] font-medium", s.isActive ? "bg-success/10 text-success" : "bg-secondary text-muted-foreground")}>
                      {s.isActive ? "Activa" : "Inactiva"}
                    </span>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">Sin coincidencias</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
