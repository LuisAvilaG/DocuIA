import { cn } from "@/lib/utils";
import { LucideIcon, Info } from "lucide-react";

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  icon: LucideIcon;
  trend?: "up" | "down" | "neutral";
  trendValue?: string;
  accent?: "default" | "success" | "warning" | "danger";
  tooltip?: string;
}

const ACCENT: Record<string, { icon: string; border: string }> = {
  default: { icon: "text-primary",     border: "border-primary/15"     },
  success: { icon: "text-success",     border: "border-success/20"     },
  warning: { icon: "text-warning",     border: "border-warning/20"     },
  danger:  { icon: "text-destructive", border: "border-destructive/15" },
};

export function StatCard({
  label, value, sub, icon: Icon, trend, trendValue, accent = "default", tooltip,
}: StatCardProps) {
  const { icon: iconCls, border } = ACCENT[accent];
  return (
    <div className={cn("bg-card rounded-xl border p-4 flex flex-col gap-3", border)}>
      <div className="flex items-center gap-1.5">
        <Icon className={cn("w-3 h-3 shrink-0", iconCls)} />
        <p className="text-[0.6875rem] font-medium text-muted-foreground uppercase tracking-[0.06em] flex-1">
          {label}
        </p>
        {tooltip && (
          <span title={tooltip} className="cursor-help">
            <Info className="w-3 h-3 text-muted-foreground/50 hover:text-muted-foreground transition-colors" />
          </span>
        )}
      </div>

      <div>
        <p className="text-[1.5rem] font-semibold text-foreground leading-[1.25] tracking-[-0.02em] tabular-nums">
          {value}
        </p>
        {(sub || trendValue) && (
          <div className="flex items-center gap-2 mt-1">
            {trendValue && (
              <span className={cn(
                "text-xs font-medium",
                trend === "up"    ? "text-success"
                : trend === "down" ? "text-destructive"
                : "text-muted-foreground"
              )}>
                {trend === "up" ? "↑" : trend === "down" ? "↓" : ""} {trendValue}
              </span>
            )}
            {sub && <span className="text-[0.6875rem] text-muted-foreground">{sub}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
