import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Small vocabulary shared by every platform-admin screen: the context panel,
// hairline section titles, key/value rows and tone pills. Server-safe.

export type Tone = "ok" | "warn" | "err" | "mute" | "info";

const PILL: Record<Tone, string> = {
  ok:   "bg-success/10 text-success",
  warn: "bg-warning/10 text-[oklch(0.50_0.14_80)]",
  err:  "bg-destructive/10 text-destructive",
  mute: "bg-secondary text-muted-foreground",
  info: "bg-primary/10 text-primary",
};

export function Pill({ tone = "mute", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11.5px] font-medium leading-tight whitespace-nowrap", PILL[tone], className)}>
      {children}
    </span>
  );
}

export function Chip({ children }: { children: ReactNode }) {
  return <span className="inline-block px-1.5 py-0.5 rounded bg-secondary text-foreground/80 text-[11px] font-medium whitespace-nowrap">{children}</span>;
}

export const PRODUCT_SHORT: Record<string, string> = {
  ap_automation: "AP", expense_management: "Gastos", contract_intelligence: "Contratos",
};
export const PRODUCT_NAME: Record<string, string> = {
  ap_automation: "AP Automation", expense_management: "Expense Management", contract_intelligence: "Contract Intelligence",
};

/**
 * 300 px paper panel between the rail and the content. It is pinned to the
 * viewport and scrolls on its own, so whatever sits at its bottom (the primary
 * action, the step note) stays visible however long the content column is.
 */
export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <aside className={cn("w-[300px] shrink-0 self-start sticky top-0 h-screen bg-card border-r border-border px-7 py-8 flex flex-col gap-7 overflow-y-auto", className)}>
      {children}
    </aside>
  );
}

export function PanelTitle({ eyebrow, title, subtitle, avatar }: { eyebrow?: ReactNode; title: ReactNode; subtitle?: ReactNode; avatar?: ReactNode }) {
  return (
    <div>
      {eyebrow && <div className="text-xs text-muted-foreground mb-4">{eyebrow}</div>}
      {avatar}
      <h1 className={cn("text-xl font-semibold tracking-[-0.02em] leading-tight", avatar && "mt-3.5")}>{title}</h1>
      {subtitle && <div className="mt-1.5 text-[13px] text-muted-foreground">{subtitle}</div>}
    </div>
  );
}

export function Avatar({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("w-14 h-14 rounded-2xl flex items-center justify-center text-[22px] font-bold", className)}
      style={{ backgroundColor: "oklch(0.22 0.10 240)", color: "oklch(0.65 0.14 182)" }}>
      {text}
    </div>
  );
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
}

/** Key/value list inside the panel. */
export function Kv({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-0.5 py-2.5 border-b border-border/60 last:border-b-0 text-[13px]", className)}>
      <span className="text-[11px] font-medium tracking-[0.06em] uppercase text-muted-foreground">{label}</span>
      <span className="text-foreground break-words">{children}</span>
    </div>
  );
}

/** Hairline section heading used in the content column. */
export function SectionTitle({ children, aside, className }: { children: ReactNode; aside?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4 border-b border-foreground pb-2", className)}>
      <h2 className="text-[13px] font-semibold">{children}</h2>
      {aside && <span className="text-xs text-muted-foreground">{aside}</span>}
    </div>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <span className="text-[11px] font-medium tracking-[0.06em] uppercase text-muted-foreground">{children}</span>;
}

/** Main content column next to the panel, centered in whatever width is left. */
export function Main({ children, className, width = "max-w-[1100px]" }: { children: ReactNode; className?: string; width?: string }) {
  return (
    <main className={cn("flex-1 min-w-0 px-10 py-9 md:px-12", className)}>
      <div className={cn("w-full mx-auto flex flex-col gap-10", width)}>{children}</div>
    </main>
  );
}

/**
 * Action row pinned to the bottom of the viewport while the content column is
 * taller than the screen (wizard steps, long forms). Cancels Main's bottom
 * padding so it sits flush against the edge.
 */
export function StickyActions({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("sticky bottom-0 z-10 -mb-9 -mt-4 py-4 flex items-center justify-end gap-2 bg-background/95 backdrop-blur-sm border-t border-border", className)}>
      {children}
    </div>
  );
}

export function Notice({ tone = "warn", title, children, action }: { tone?: Tone; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  const styles: Record<Tone, string> = {
    warn: "bg-[oklch(0.97_0.03_80)] border-[oklch(0.80_0.10_80)]",
    err:  "bg-destructive/5 border-destructive/25",
    ok:   "bg-success/5 border-success/25",
    info: "bg-primary/5 border-primary/25",
    mute: "bg-secondary border-border",
  };
  return (
    <div className={cn("rounded-xl border px-5 py-4 flex items-center gap-5", styles[tone])}>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold">{title}</div>
        {children && <div className="text-[13px] text-muted-foreground mt-0.5">{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function relativeTime(value: string | Date | null | undefined): string {
  if (!value) return "nunca";
  const d = typeof value === "string" ? new Date(value) : value;
  const diffMin = Math.round((Date.now() - d.getTime()) / 60_000);
  if (diffMin < 1) return "ahora";
  if (diffMin < 60) return `hace ${diffMin} min`;
  const h = Math.round(diffMin / 60);
  if (h < 24) return `hace ${h} h`;
  const days = Math.round(h / 24);
  if (days === 1) return "ayer";
  if (days < 30) return `hace ${days} días`;
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

export function fmtDate(value: string | Date | null | undefined, withTime = false): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) });
}

export function num(n: number): string {
  return n.toLocaleString("es-MX");
}
