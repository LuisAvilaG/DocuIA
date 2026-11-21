"use client";

import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Panel lateral modal del rediseño: encabezado con título, cuerpo con scroll y pie con acciones.
 * Escape y el fondo cierran salvo que `locked` (p. ej. mientras sube un lote).
 */
export function Drawer({ title, description, onClose, locked = false, footer, children, width = 580, className }: {
  title: React.ReactNode;
  description?: React.ReactNode;
  onClose: () => void;
  locked?: boolean;
  footer?: React.ReactNode;
  children: React.ReactNode;
  width?: number;
  className?: string;
}) {
  const titleId = useId();
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    // A field inside that already took the focus (autoFocus) keeps it.
    if (!panel.current?.contains(document.activeElement)) panel.current?.focus();
    return () => prev?.focus?.();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !locked) { onClose(); return; }
      const el = panel.current;
      if (e.key !== "Tab" || !el) return;
      // Modal: Tab stays in the panel instead of reaching the page it covers.
      const at = document.activeElement as HTMLElement | null;
      const inside = el.contains(at);
      // A menu or dialog opened from the panel renders outside it and keeps its own focus.
      if (!inside && at && at !== document.body && at.closest('[role="dialog"], [role="listbox"], [role="menu"]')) return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((item) => item.offsetParent !== null);
      const first = items[0] ?? el, last = items[items.length - 1] ?? el;
      if (!inside) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && (at === first || at === el)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, locked]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-[rgba(30,32,41,0.38)]" onMouseDown={(e) => { if (e.target === e.currentTarget && !locked) onClose(); }}>
      <aside
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{ maxWidth: width }}
        className={cn("flex h-full w-full flex-col border-l border-border bg-card shadow-[-24px_0_60px_rgba(30,32,41,0.18)] outline-none", className)}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line-soft px-7 pb-4 pt-6">
          <div className="min-w-0">
            <h2 id={titleId} className="text-xl font-semibold tracking-[-0.02em]">{title}</h2>
            {description && <div className="mt-1 text-[13.5px] text-muted-foreground">{description}</div>}
          </div>
          <button type="button" onClick={onClose} disabled={locked} aria-label="Cerrar"
            className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-foreground/70 hover:text-foreground disabled:opacity-40">
            <X className="size-4" />
          </button>
        </header>
        <div className="flex flex-1 flex-col gap-5.5 overflow-y-auto px-7 py-5.5">{children}</div>
        {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-7 py-3.5">{footer}</footer>}
      </aside>
    </div>
  );
}
