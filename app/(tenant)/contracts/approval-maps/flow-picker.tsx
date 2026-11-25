"use client";

// Elegir flujos cuando hay muchos: buscador, un filtro («Sin mapa / Todos»),
// una lista de alto fijo y «Marcar los N» para lo que muestra la búsqueda.
// Se usa en Mapa nuevo y, desplegado dentro del panel, en «Lo usan» del editor
// y en los caminos de una pregunta por tipo de contrato. Los flujos desactivados no se ofrecen: quien
// lo usa le pasa solo los activos.
import { useId, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PickerFlow { id: string; name: string; /** «usa «Pólizas»», «en el camino 2»… */ note?: string | null }
export interface PickerScope { key: string; label: string; /** null = todos */ ids: ReadonlySet<string> | null }

/** Sin acentos ni mayúsculas, letra por letra para que las posiciones coincidan con el texto. */
function fold(text: string): string {
  return [...text].map((c) => c.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().slice(0, 1) || c).join("");
}

function Highlight({ text, query }: { text: string; query: string }) {
  const q = fold(query);
  const at = q ? fold(text).indexOf(q) : -1;
  if (at < 0) return <>{text}</>;
  const chars = [...text];
  return <>{chars.slice(0, at).join("")}<mark className="rounded-[2px] bg-[#FFF1BF] text-inherit">{chars.slice(at, at + q.length).join("")}</mark>{chars.slice(at + q.length).join("")}</>;
}

export function FlowPicker({ flows, selected, onChange, scopes, emptyText, autoFocus, actions, onClose, className }: {
  flows: PickerFlow[];
  selected: string[];
  onChange: (next: string[]) => void;
  scopes?: PickerScope[];
  /** Cuando no hay ningún flujo que ofrecer. */
  emptyText: string;
  autoFocus?: boolean;
  /** Botones a la derecha del pie (Cancelar, Agregar…). */
  actions?: React.ReactNode;
  /** Escape con la búsqueda vacía. */
  onClose?: () => void;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  // Empieza en el primer filtro que tiene algo; si ninguno, en el último («Todos»).
  const [scopeKey, setScopeKey] = useState(() => scopes?.find((s) => !s.ids || s.ids.size > 0)?.key ?? scopes?.at(-1)?.key ?? null);
  const scope = scopes?.find((s) => s.key === scopeKey) ?? null;
  const chosen = useMemo(() => new Set(selected), [selected]);
  const q = query.trim();
  const visible = useMemo(() => {
    const needle = fold(q);
    return flows
      // Lo ya marcado no desaparece al cambiar de filtro.
      .filter((f) => !scope?.ids || scope.ids.has(f.id) || chosen.has(f.id))
      .filter((f) => !needle || fold(f.name).includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, [flows, scope, chosen, q]);
  const unmarked = visible.filter((f) => !chosen.has(f.id));
  const listId = useId();

  const toggle = (id: string) => onChange(chosen.has(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  return (
    <div className={cn("overflow-hidden rounded-[10px] border border-[#D6D2C8] bg-white", className)}
      onKeyDown={(e) => { if (e.key !== "Escape") return; e.stopPropagation(); if (query) setQuery(""); else onClose?.(); }}>
      <div className="flex flex-col gap-2.5 border-b border-line-soft bg-card px-3 py-2.5">
        <label className="flex min-h-[38px] items-center gap-2 rounded-lg border border-[#D6D2C8] bg-white px-2.5 focus-within:border-primary focus-within:ring-3 focus-within:ring-ring/40">
          <Search aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span className="sr-only">Buscar flujo</span>
          <input type="text" value={query} autoFocus={autoFocus} onChange={(e) => setQuery(e.target.value)} aria-controls={listId}
            placeholder={`Buscar entre ${flows.length} flujo${flows.length === 1 ? "" : "s"}`}
            className="min-w-0 flex-1 bg-transparent text-[13.5px] outline-none" />
          {query && <button type="button" onClick={() => setQuery("")} aria-label="Borrar la búsqueda" className="text-muted-foreground hover:text-foreground"><X className="size-4" /></button>}
        </label>
        {scopes && scopes.length > 1 && (
          <div role="group" aria-label="Mostrar" className="inline-flex self-start overflow-hidden rounded-lg border border-[#D6D2C8]">
            {scopes.map((s, i) => (
              <button key={s.key} type="button" aria-pressed={s.key === scopeKey} onClick={() => setScopeKey(s.key)}
                className={cn("px-2.5 py-1 text-[12.5px]", i > 0 && "border-l border-[#D6D2C8]", s.key === scopeKey ? "bg-tone-info-bg font-semibold text-tone-info" : "bg-white text-foreground/75 hover:bg-secondary/60")}>
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div id={listId} role="group" aria-label="Flujos" className="max-h-[264px] overflow-y-auto">
        {flows.length === 0 ? (
          <p className="px-3 py-4 text-[13px] text-muted-foreground">{emptyText}</p>
        ) : visible.length === 0 ? (
          <p className="px-3 py-4 text-[13px] text-muted-foreground">{q ? <>Ningún flujo tiene «{q}».</> : "No hay flujos en este filtro."}</p>
        ) : visible.map((f) => (
          <label key={f.id} className="flex min-h-10 cursor-pointer items-center gap-2.5 border-t border-[#F1EFEA] px-3 py-1.5 text-[13.5px] first:border-t-0 hover:bg-background">
            <input type="checkbox" checked={chosen.has(f.id)} onChange={() => toggle(f.id)} className="size-4 shrink-0 accent-[var(--color-primary)]" />
            <span className="min-w-0 flex-1"><Highlight text={f.name} query={q} /></span>
            {f.note && <span className="max-w-[45%] shrink-0 truncate rounded-full bg-tone-warn-bg px-2 py-px text-xs text-[#5B4208]">{f.note}</span>}
          </label>
        ))}
      </div>

      {(flows.length > 0 || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line-soft bg-card px-3 py-2 text-[12.5px]">
          <span className="text-muted-foreground" aria-live="polite">
            {q ? `${visible.length} flujo${visible.length === 1 ? "" : "s"} con «${q}»` : selected.length ? `${selected.length} elegido${selected.length === 1 ? "" : "s"}` : `${visible.length} flujo${visible.length === 1 ? "" : "s"}`}
          </span>
          <span className="flex items-center gap-2">
            {q && unmarked.length > 0 && (
              <button type="button" onClick={() => onChange([...selected, ...unmarked.map((f) => f.id)])} className="font-semibold text-link hover:underline">
                Marcar {unmarked.length === 1 ? "ese" : `los ${unmarked.length}`}
              </button>
            )}
            {actions}
          </span>
        </div>
      )}
    </div>
  );
}

/** Ficha de un flujo elegido, con su × para quitarlo. */
export function FlowChip({ name, tag, onRemove }: { name: string; tag?: string | null; onRemove?: () => void }) {
  return (
    <span className="inline-flex max-w-full items-center gap-0.5 rounded-full bg-tone-info-bg py-0.5 pl-2.5 pr-1 text-[12.5px] font-semibold text-tone-info">
      <span className="truncate">{name}</span>
      {tag && <span className="ml-1 font-normal text-muted-foreground">· {tag}</span>}
      {onRemove
        ? <button type="button" onClick={onRemove} aria-label={`Quitar ${name}`} className="ml-0.5 flex size-5 shrink-0 items-center justify-center rounded-full hover:bg-white/70"><X className="size-3.5" /></button>
        : <span className="w-1.5" />}
    </span>
  );
}
