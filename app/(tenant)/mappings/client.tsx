"use client";

import { useState, useMemo } from "react";
import { Search, GitMerge, CheckCircle2, Zap, User, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

type Mapping = {
  id: number;
  subsidiaryId: string;
  subsidiaryName: string;
  vendor: string;
  vendorItemName: string;
  netsuiteInternalId: string;
  netsuiteItemName: string | null;
  netsuiteUnit: string | null;
  timesConfirmed: number;
  autoMap: boolean;
  lastConfirmed: string | null;
};

interface Props {
  subsidiaries: { id: string; name: string }[];
  mappings: Mapping[];
}

type ModeFilter = "all" | "auto" | "manual";

function relativeDate(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (diff === 0) return "hoy";
  if (diff === 1) return "ayer";
  if (diff < 7) return `hace ${diff} días`;
  return new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}

export function MappingsClient({ subsidiaries, mappings }: Props) {
  const [subFilter, setSubFilter] = useState<string>("all");
  const [vendorFilter, setVendorFilter] = useState<string>("all");
  const [modeFilter, setModeFilter] = useState<ModeFilter>("all");
  const [search, setSearch] = useState("");

  const vendors = useMemo(() => {
    const unique = Array.from(new Set(mappings.map(m => m.vendor).filter(Boolean))).sort();
    return unique;
  }, [mappings]);

  const filtered = useMemo(() => {
    let result = mappings;
    if (subFilter !== "all") result = result.filter(m => m.subsidiaryId === subFilter);
    if (vendorFilter !== "all") result = result.filter(m => m.vendor === vendorFilter);
    if (modeFilter === "auto") result = result.filter(m => m.autoMap);
    if (modeFilter === "manual") result = result.filter(m => !m.autoMap);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(m =>
        m.vendorItemName.toLowerCase().includes(q) ||
        (m.netsuiteItemName?.toLowerCase().includes(q) ?? false) ||
        m.vendor.toLowerCase().includes(q)
      );
    }
    return result;
  }, [mappings, subFilter, vendorFilter, modeFilter, search]);

  const activeFilters = (subFilter !== "all" ? 1 : 0) + (vendorFilter !== "all" ? 1 : 0) + (modeFilter !== "all" ? 1 : 0);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Topbar */}
      <div className="h-14 border-b border-border px-6 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-sm font-semibold tracking-[-0.01em] text-foreground">Mapeos de ítems</h1>
          <p className="text-xs text-muted-foreground">
            {filtered.length !== mappings.length
              ? `${filtered.length.toLocaleString("es-MX")} de ${mappings.length.toLocaleString("es-MX")} mapeos`
              : `${mappings.length.toLocaleString("es-MX")} mapeos confirmados`}
          </p>
        </div>
        {activeFilters > 0 && (
          <button
            onClick={() => { setSubFilter("all"); setVendorFilter("all"); setModeFilter("all"); setSearch(""); }}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="border-b border-border px-6 py-3 flex items-center gap-3 shrink-0 flex-wrap">
        {/* Search */}
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Buscar ítem o proveedor..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-[7px] text-xs bg-card border border-border rounded-md text-foreground placeholder:text-muted-foreground/50 outline-none transition-all duration-[120ms] focus:border-primary focus:shadow-[0_0_0_3px_oklch(0.48_0.15_182_/_0.12)]"
          />
        </div>

        {/* Vendor filter */}
        {vendors.length > 0 && (
          <div className="relative">
            <select
              value={vendorFilter}
              onChange={e => setVendorFilter(e.target.value)}
              className={cn(
                "appearance-none pl-3 pr-7 py-[7px] text-xs rounded-md border transition-all duration-[120ms] outline-none cursor-pointer",
                vendorFilter !== "all"
                  ? "bg-primary/10 border-primary/40 text-primary font-medium"
                  : "bg-card border-border text-muted-foreground hover:text-foreground hover:border-border/80"
              )}
            >
              <option value="all">Todos los proveedores</option>
              {vendors.map(v => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none text-muted-foreground" />
          </div>
        )}

        {/* Mode filter */}
        <div className="flex items-center gap-1">
          {(["all", "auto", "manual"] as ModeFilter[]).map(m => (
            <button
              key={m}
              onClick={() => setModeFilter(m)}
              className={cn(
                "flex items-center gap-1 px-3 py-[5px] text-xs rounded-md font-medium transition-all duration-[120ms]",
                modeFilter === m
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              )}
            >
              {m === "auto" && <Zap className="w-3 h-3" />}
              {m === "manual" && <User className="w-3 h-3" />}
              {m === "all" ? "Todos" : m === "auto" ? "Auto" : "Manual"}
            </button>
          ))}
        </div>

        {/* Subsidiary filter */}
        {subsidiaries.length > 1 && (
          <div className="flex items-center gap-1.5 border-l border-border pl-3">
            <button
              onClick={() => setSubFilter("all")}
              className={cn(
                "px-3 py-[5px] text-xs rounded-md font-medium transition-all duration-[120ms]",
                subFilter === "all"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              )}
            >
              Todas
            </button>
            {subsidiaries.map(s => (
              <button
                key={s.id}
                onClick={() => setSubFilter(s.id)}
                className={cn(
                  "px-3 py-[5px] text-xs rounded-md font-medium transition-all duration-[120ms]",
                  subFilter === s.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                )}
              >
                {s.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="py-20 flex flex-col items-center justify-center text-center">
            <GitMerge className="w-8 h-8 text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium text-foreground">
              {activeFilters > 0 || search ? "Sin resultados para los filtros seleccionados" : "Sin mapeos aún"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {activeFilters > 0 || search
                ? "Intenta ajustar los filtros"
                : "Los mapeos se crean automáticamente al procesar documentos"}
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card border-b border-border z-10">
              <tr>
                {["Ítem proveedor", "Proveedor", "Ítem NetSuite", "Unidad", "Confirma.", "Modo", "Últ. confirmación"].map(h => (
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
              {filtered.map(m => (
                <tr key={m.id} className="hover:bg-accent/40 transition-colors duration-[120ms]">
                  <td className="px-5 py-3">
                    <p className="text-xs font-medium text-foreground leading-snug">{m.vendorItemName}</p>
                    {subsidiaries.length > 1 && (
                      <p className="text-[0.6875rem] text-muted-foreground mt-0.5">{m.subsidiaryName}</p>
                    )}
                  </td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">{m.vendor}</td>
                  <td className="px-5 py-3">
                    <p className="text-xs text-foreground leading-snug">
                      {m.netsuiteItemName ?? m.netsuiteInternalId}
                    </p>
                    <p className="text-[0.6875rem] text-muted-foreground font-mono mt-0.5">
                      #{m.netsuiteInternalId}
                    </p>
                  </td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">{m.netsuiteUnit ?? "—"}</td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-1.5">
                      <CheckCircle2 className="w-3 h-3 text-success shrink-0" />
                      <span className="text-xs tabular-nums text-foreground">{m.timesConfirmed}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <span className={cn(
                      "inline-flex items-center gap-1 text-[0.6875rem] font-medium px-2 py-0.5 rounded-sm",
                      m.autoMap
                        ? "bg-primary/10 text-primary"
                        : "bg-secondary text-muted-foreground"
                    )}>
                      {m.autoMap
                        ? <Zap className="w-2.5 h-2.5" />
                        : <User className="w-2.5 h-2.5" />}
                      {m.autoMap ? "Auto" : "Manual"}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-[0.6875rem] text-muted-foreground tabular-nums">
                    {m.lastConfirmed ? relativeDate(m.lastConfirmed) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
