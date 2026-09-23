"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Building2, Check, ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Searchable subsidiary selector. Scales to accounts with dozens of
 * subsidiaries, where a row of buttons would overflow the header.
 */
export function SubsidiaryPicker({
  subsidiaries, value, onChange, allLabel, className,
}: {
  subsidiaries: { id: string; name: string }[];
  value: string;
  onChange: (id: string) => void;
  /** When set, adds an "all subsidiaries" option with value "all". */
  allLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); clearTimeout(t); };
  }, [open]);

  const options = useMemo(() => {
    const sorted = [...subsidiaries].sort((a, b) => a.name.localeCompare(b.name, "es", { numeric: true }));
    const q = query.trim().toLowerCase();
    return q ? sorted.filter((s) => s.name.toLowerCase().includes(q)) : sorted;
  }, [subsidiaries, query]);

  const current = value === "all" && allLabel ? allLabel : subsidiaries.find((s) => s.id === value)?.name ?? "Selecciona una subsidiaria";

  function pick(id: string) {
    onChange(id);
    setOpen(false);
    setQuery("");
  }

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full min-w-[220px] max-w-[340px] items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-left text-xs text-foreground hover:bg-secondary/60 transition-colors"
      >
        <Building2 className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate font-medium">{current}</span>
        <span className="shrink-0 text-[0.6875rem] text-muted-foreground tabular-nums">{subsidiaries.length}</span>
        <ChevronDown className={cn("w-3.5 h-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute left-0 z-40 mt-1 w-[340px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-border bg-card shadow-[0_8px_32px_oklch(0.18_0.015_258_/_0.12)]">
          <div className="relative border-b border-border">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && options[0]) pick(options[0].id); }}
              placeholder="Buscar subsidiaria…"
              aria-label="Buscar subsidiaria"
              className="w-full bg-transparent py-2.5 pl-9 pr-3 text-xs text-foreground outline-none placeholder:text-muted-foreground/60"
            />
          </div>
          <ul role="listbox" className="max-h-72 overflow-y-auto py-1">
            {allLabel && !query && (
              <li>
                <button type="button" role="option" aria-selected={value === "all"} onClick={() => pick("all")}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-secondary/60">
                  <span className="flex-1 font-medium text-foreground">{allLabel}</span>
                  {value === "all" && <Check className="w-3.5 h-3.5 text-primary" />}
                </button>
              </li>
            )}
            {options.map((s) => (
              <li key={s.id}>
                <button type="button" role="option" aria-selected={value === s.id} onClick={() => pick(s.id)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-secondary/60">
                  <span className={cn("flex-1 truncate", value === s.id ? "font-semibold text-foreground" : "text-foreground")}>{s.name}</span>
                  {value === s.id && <Check className="w-3.5 h-3.5 shrink-0 text-primary" />}
                </button>
              </li>
            ))}
            {options.length === 0 && <li className="px-3 py-3 text-xs text-muted-foreground">Sin coincidencias</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
