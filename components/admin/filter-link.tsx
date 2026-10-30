"use client";

import { cn } from "@/lib/utils";

/** One row of a panel filter list, with an optional count on the right. */
export function FilterLink({ active, onClick, children, count }: { active: boolean; onClick: () => void; children: React.ReactNode; count?: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full flex items-center justify-between px-2.5 py-[7px] rounded-lg text-[13px] text-left transition-colors",
        active ? "bg-primary/10 text-primary font-medium" : "text-foreground/80 hover:bg-secondary",
      )}
    >
      <span>{children}</span>
      {count !== undefined && <span className="text-xs tabular-nums opacity-80">{count}</span>}
    </button>
  );
}
