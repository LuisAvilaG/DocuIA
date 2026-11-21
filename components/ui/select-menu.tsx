"use client";

import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { ChevronDown, Check } from "lucide-react";

export interface SelectMenuOption {
  value: string;
  label: string;
  hint?: string;
}

/**
 * Styled single-select that matches the app's custom dropdowns. Unlike a native
 * <select>, the option list is our own markup, so it looks consistent with the
 * rest of the UI (native selects render an OS-styled popup we can't theme).
 */
export function SelectMenu({
  value,
  onChange,
  options,
  placeholder = "Selecciona…",
  leadingLabel,
  ariaLabel,
  align = "left",
  className,
  menuClassName,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectMenuOption[];
  placeholder?: string;
  leadingLabel?: string;
  ariaLabel?: string;
  align?: "left" | "right";
  className?: string;
  menuClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Closing by keyboard leaves the focus on the button that opened the list.
  const closeToTrigger = () => { setOpen(false); triggerRef.current?.focus(); };

  useEffect(() => {
    if (!open) return;
    // The list opens on the chosen option (or the first), ready for the arrows.
    const list = listRef.current;
    (list?.querySelector<HTMLElement>('[aria-selected="true"]') ?? list?.querySelector<HTMLElement>('[role="option"]'))?.focus();
    function onDocMouseDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      const inside = rootRef.current?.contains(document.activeElement);
      setOpen(false);
      if (inside) triggerRef.current?.focus();
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function onListKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const items = [...(listRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const go = (index: number) => { e.preventDefault(); items[Math.max(0, Math.min(items.length - 1, index))]?.focus(); };
    if (e.key === "ArrowDown") go(at + 1);
    else if (e.key === "ArrowUp") go(at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(items.length - 1);
    // Tab leaves the list: it closes, and the focus goes on from the button.
    else if (e.key === "Tab") closeToTrigger();
  }

  const selected = options.find(o => o.value === value) ?? null;

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
        onKeyDown={(e) => { if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) { e.preventDefault(); setOpen(true); } }}
        className={cn(
          "w-full flex items-center gap-1.5 bg-background border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground",
          "hover:border-border/80 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-[border-color,box-shadow]",
          open && "border-primary ring-2 ring-primary/10",
        )}
      >
        {leadingLabel && (
          <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/70 shrink-0">
            {leadingLabel}
          </span>
        )}
        <span className={cn("flex-1 min-w-0 truncate text-left", !selected && "text-muted-foreground")}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground shrink-0 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div
          ref={listRef}
          role="listbox"
          onKeyDown={onListKeyDown}
          className={cn(
            "absolute top-full mt-1 z-40 min-w-full max-h-64 overflow-y-auto bg-card border border-border rounded-xl py-1",
            align === "right" ? "right-0" : "left-0",
            menuClassName,
          )}
          style={{ boxShadow: "0 8px 32px oklch(0.18 0.015 258 / 0.14), 0 2px 8px oklch(0.18 0.015 258 / 0.07)" }}
        >
          {options.map(opt => {
            const isSel = opt.value === value;
            return (
              <button
                key={opt.value || "__empty"}
                type="button"
                role="option"
                aria-selected={isSel}
                onClick={(e) => { e.stopPropagation(); onChange(opt.value); closeToTrigger(); }}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors focus:outline-none focus-visible:bg-secondary",
                  isSel ? "bg-primary/8" : "hover:bg-secondary/60",
                )}
              >
                <div className="flex-1 min-w-0">
                  <span className={cn("block truncate text-xs", isSel ? "font-semibold text-foreground" : "text-foreground")}>
                    {opt.label}
                  </span>
                  {opt.hint && <span className="block truncate text-[10px] text-muted-foreground">{opt.hint}</span>}
                </div>
                {isSel && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
