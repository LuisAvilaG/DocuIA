"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

const PERIODS = [
  { id: "7d", label: "7 días" },
  { id: "month", label: "Mes" },
  { id: "quarter", label: "Trimestre" },
];

export function StatsFilters({ subsidiaries, vendors, groupToggle }: {
  subsidiaries: { id: string; name: string }[];
  vendors: string[];
  groupToggle: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const period = params.get("period") ?? "month";

  function set(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value); else next.delete(key);
    router.push(`/statistics${next.size ? `?${next}` : ""}`, { scroll: false });
  }

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      {subsidiaries.length > 1 && (
        <>
          <label className="text-xs text-muted-foreground" htmlFor="st-sub">Subsidiaria</label>
          <select id="st-sub" value={params.get("sub") ?? ""} onChange={(e) => set("sub", e.target.value || null)}>
            <option value="">Todas</option>
            {subsidiaries.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </>
      )}
      {vendors.length > 0 && (
        <>
          <label className="text-xs text-muted-foreground" htmlFor="st-vendor">Proveedor</label>
          <select id="st-vendor" value={params.get("vendor") ?? ""} onChange={(e) => set("vendor", e.target.value || null)} className="max-w-[220px]">
            <option value="">Todos</option>
            {vendors.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </>
      )}
      {groupToggle && (
        <div className="inline-flex rounded-lg border border-border bg-card p-0.5" role="group" aria-label="Agrupar">
          {[{ id: "", label: "Proveedor" }, { id: "category", label: "Categoría" }].map((g) => {
            const on = (params.get("group") ?? "") === g.id;
            return (
              <button key={g.id} type="button" aria-pressed={on} onClick={() => set("group", g.id || null)}
                className={cn("px-3 py-1.5 text-xs font-medium rounded-md transition-colors", on ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                {g.label}
              </button>
            );
          })}
        </div>
      )}
      <div className="inline-flex rounded-lg border border-border bg-card p-0.5" role="group" aria-label="Periodo">
        {PERIODS.map((p) => (
          <button key={p.id} type="button" aria-pressed={period === p.id} onClick={() => set("period", p.id === "month" ? null : p.id)}
            className={cn("px-3 py-1.5 text-xs font-medium rounded-md transition-colors", period === p.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
