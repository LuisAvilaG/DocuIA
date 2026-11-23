import Link from "next/link";
import { cn } from "@/lib/utils";

/** Estado visual de una etapa. */
export type StageState = "ok" | "warn" | "err" | "now" | "run" | "off";

export interface Stage {
  key: string;
  label: string;
  detail?: string;
  state: StageState;
  /** Sin href ni onSelect la etapa no es navegable (ej. «Decisión · Pendiente»). */
  href?: string;
  /** Para etapas que cambian de vista sin navegar (estado que no debe perderse). */
  onSelect?: () => void;
}

export interface AuxLink { key: string; label: string; href: string; count?: number }

const MARK: Record<StageState, { cls: string; glyph: string }> = {
  ok:   { cls: "bg-tone-ok-bg text-tone-ok", glyph: "✓" },
  warn: { cls: "bg-tone-warn-bg text-tone-warn", glyph: "!" },
  err:  { cls: "bg-tone-err-bg text-tone-err", glyph: "!" },
  now:  { cls: "bg-[#B07C0E] text-white", glyph: "●" },
  run:  { cls: "border-2 border-primary border-r-transparent animate-spin", glyph: "" },
  off:  { cls: "border-[1.5px] border-dashed border-[#B9B5AC]", glyph: "" },
};

/**
 * Barra de etapas que también es la navegación del caso o la factura.
 * La etapa actual se subraya; las auxiliares (Actividad…) van al final, separadas.
 */
export function StageNav({ stages, current, aux = [], label = "Etapas", className }: {
  stages: Stage[];
  current?: string;
  aux?: AuxLink[];
  label?: string;
  className?: string;
}) {
  return (
    <nav aria-label={label} className={cn("flex items-stretch overflow-x-auto rounded-[10px] border border-border bg-card", className)}>
      {stages.map((s) => {
        const isCurrent = s.key === current;
        const mark = MARK[s.state];
        const inner = (
          <>
            <span aria-hidden className={cn("mt-px flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold box-border", mark.cls)}>
              {mark.glyph}
            </span>
            <span className="min-w-0">
              <span className={cn("block truncate text-[13px] font-semibold leading-tight", !s.href && !s.onSelect && "font-medium text-muted-foreground")}>{s.label}</span>
              {s.detail && <span className="block truncate text-xs text-muted-foreground">{s.detail}</span>}
            </span>
          </>
        );
        const base = "relative flex min-w-0 flex-1 basis-0 items-start gap-2.5 border-r border-line-soft px-3 pt-[11px] pb-[13px]";
        const active = cn(base, "text-left text-foreground hover:bg-secondary", isCurrent && "bg-white after:absolute after:inset-x-0 after:bottom-0 after:h-[3px] after:bg-foreground");
        if (s.onSelect) {
          return <button key={s.key} type="button" onClick={s.onSelect} aria-current={isCurrent ? "page" : undefined} className={active}>{inner}</button>;
        }
        if (!s.href) return <span key={s.key} className={base}>{inner}</span>;
        return (
          <Link
            key={s.key}
            href={s.href}
            aria-current={isCurrent ? "page" : undefined}
            className={active}
          >
            {inner}
          </Link>
        );
      })}
      {aux.length > 0 && <span aria-hidden className="w-1.5 shrink-0 border-r border-border bg-secondary" />}
      {aux.map((a, i) => {
        const isCurrent = a.key === current;
        return (
          <Link
            key={a.key}
            href={a.href}
            aria-current={isCurrent ? "page" : undefined}
            className={cn(
              "relative flex shrink-0 items-center gap-1.5 whitespace-nowrap px-4 text-[13px] font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground",
              i > 0 && "border-l border-line-soft",
              isCurrent && "bg-white text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-[3px] after:bg-foreground",
            )}
          >
            {a.label}
            {a.count != null && <em className="rounded-full bg-secondary px-1.5 text-[11.5px] not-italic">{a.count}</em>}
          </Link>
        );
      })}
    </nav>
  );
}
