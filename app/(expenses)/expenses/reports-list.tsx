"use client";

import Link from "next/link";
import { Receipt, ChevronRight, Clock, CheckCircle2, XCircle, AlertCircle, Send } from "lucide-react";
import { cn } from "@/lib/utils";

const STATUS_CONFIG = {
  draft:        { label: "Borrador",     color: "text-muted-foreground bg-muted",     icon: Clock },
  submitted:    { label: "Enviado",      color: "text-primary bg-primary/10",          icon: Send },
  under_review: { label: "En revisión",  color: "text-warning bg-warning/10",          icon: Clock },
  approved:     { label: "Aprobado",     color: "text-success bg-success/10",          icon: CheckCircle2 },
  rejected:     { label: "Rechazado",    color: "text-destructive bg-destructive/10",  icon: XCircle },
  syncing:      { label: "Sincronizando",color: "text-primary bg-primary/10",          icon: Clock },
  synced:       { label: "En NetSuite",  color: "text-success bg-success/10",          icon: CheckCircle2 },
  exception:    { label: "Error",        color: "text-destructive bg-destructive/10",  icon: AlertCircle },
} as const;

interface Report {
  id:          string;
  purpose:     string;
  status:      keyof typeof STATUS_CONFIG;
  submittedAt: string | null;
  createdAt:   string;
  items:       { id: string; total: string | null }[];
}

export function ExpenseReportsList({ reports }: { reports: Report[] }) {
  if (!reports.length) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center px-6">
        <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
          <Receipt className="w-6 h-6 text-primary" />
        </div>
        <p className="text-sm font-medium text-foreground">Sin informes de gastos</p>
        <p className="text-xs text-muted-foreground mt-1 max-w-xs">
          Crea tu primer informe para empezar a registrar tus gastos en campo.
        </p>
        <a
          href="/expenses/new"
          className="mt-4 inline-flex items-center px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          Nuevo informe
        </a>
      </div>
    );
  }

  return (
    <div className="divide-y divide-border">
      {reports.map((r) => {
        const cfg   = STATUS_CONFIG[r.status] ?? STATUS_CONFIG.draft;
        const Icon  = cfg.icon;
        const total = r.items.reduce((s, i) => s + parseFloat(i.total ?? "0"), 0);
        const date  = r.submittedAt ? new Date(r.submittedAt) : new Date(r.createdAt);

        return (
          <Link
            key={r.id}
            href={`/expenses/${r.id}`}
            className="flex items-center gap-4 px-5 py-4 hover:bg-accent/40 transition-colors"
          >
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <Receipt className="w-4.5 h-4.5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{r.purpose}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {r.items.length} gasto{r.items.length !== 1 ? "s" : ""} · {date.toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" })}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1.5 shrink-0">
              <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.6875rem] font-medium", cfg.color)}>
                <Icon className="w-3 h-3" />
                {cfg.label}
              </span>
              {total > 0 && (
                <p className="text-xs tabular-nums text-muted-foreground">
                  {total.toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 })}
                </p>
              )}
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
          </Link>
        );
      })}
    </div>
  );
}
