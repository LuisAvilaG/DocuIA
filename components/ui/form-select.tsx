"use client";

import { SelectHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

const NativeSelect = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <div className="relative">
    <select
      ref={ref}
      className={cn(
        "w-full appearance-none bg-background border border-border rounded-lg px-3 py-[9px]",
        "text-sm text-foreground outline-none pr-8",
        "transition-colors focus:border-primary focus:ring-[3px] focus:ring-primary/10",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        className
      )}
      {...props}
    >
      {children}
    </select>
  </div>
));
NativeSelect.displayName = "NativeSelect";

export { NativeSelect };
