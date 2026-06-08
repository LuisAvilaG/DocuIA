"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  FileText, ChevronRight, InboxIcon, Clock,
  CheckCircle2, AlertCircle, XCircle, RefreshCw, Download,
} from "lucide-react";
import { EXPENSE_REPORT_STATUS } from "@/lib/status-config";

// ── Types ─────────────────────────────────────────────────────────────

export interface ReportRow {
  id: string;
  purpose: string;
  status: string;
  submittedAt: string | null;
  approvedAt: string | null;
  createdAt: string;
  syncError: string | null;
  netsuiteExpenseReportId: string | null;
  submitter: { fullName: string | null; email: string };
  items: { id: string; total: string | null }[];
}


// ── Filter tabs ───────────────────────────────────────────────────────

const TABS = [
  { key: "all",       label: "Todos" },
  { key: "submitted", label: "Pendientes" },
  { key: "approved",  label: "Aprobados" },
  { key: "synced",    label: "Sincronizados" },
  { key: "exception", label: "Excepciones" },
  { key: "rejected",  label: "Rechazados" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

// ── Helpers ───────────────────────────────────────────────────────────

function calcTotal(items: { total: string | null }[]): number {
  return items.reduce((s, i) => s + parseFloat(i.total ?? "0"), 0);
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-CO", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

function fmtCurrency(n: number): string {
  return n.toLocaleString("es-CO", {
    style: "currency", currency: "COP", maximumFractionDigits: 0,
  });
}

// ── Component ─────────────────────────────────────────────────────────

export function AccountingExpenseList({ reports }: { reports: ReportRow[] }) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabKey>("all");

  const filtered = reports.filter((r) => {
    if (activeTab === "all") return true;
    if (activeTab === "submitted") return r.status === "submitted" || r.status === "under_review";
    return r.status === activeTab;
  });

  // Badge counts
  const counts: Record<TabKey, number> = {
    all:       reports.length,
    submitted: reports.filter((r) => r.status === "submitted" || r.status === "under_review").length,
    approved:  reports.filter((r) => r.status === "approved").length,
    synced:    reports.filter((r) => r.status === "synced" || r.status === "syncing").length,
    exception: reports.filter((r) => r.status === "exception").length,
    rejected:  reports.filter((r) => r.status === "rejected").length,
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Page header */}
      <div className="p-5 border-b border-border shrink-0 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Informes de gastos</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Revisa, aprueba y sincroniza informes a NetSuite
          </p>
        </div>
        <a
          href="/api/v1/expenses/reports/export"
          download
          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
          Exportar CSV
        </a>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 px-4 pt-3 pb-0 overflow-x-auto shrink-0 scrollbar-hide">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap",
              activeTab === tab.key
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
            )}
          >
            {tab.label}
            {counts[tab.key] > 0 && (
              <span className={cn(
                "inline-flex items-center justify-center min-w-[1.125rem] h-[1.125rem] rounded-full text-[0.625rem] font-semibold px-1",
                activeTab === tab.key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
              )}>
                {counts[tab.key]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <InboxIcon className="w-8 h-8 text-muted-foreground mb-3" />
            <p className="text-sm font-medium text-foreground">Sin informes</p>
            <p className="text-xs text-muted-foreground mt-1">
              No hay informes en esta categoría.
            </p>
          </div>
        ) : (
          filtered.map((report) => {
            const cfg   = EXPENSE_REPORT_STATUS[report.status] ?? EXPENSE_REPORT_STATUS["submitted"];
            const Icon  = cfg.icon;
            const total = calcTotal(report.items);

            return (
              <button
                key={report.id}
                onClick={() => router.push(`/accounting/expenses/${report.id}`)}
                className="w-full text-left bg-card border border-border rounded-xl p-4 hover:border-primary/40 hover:bg-card/80 transition-all group"
              >
                <div className="flex items-start gap-3">
                  {/* Icon */}
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    <FileText className="w-4.5 h-4.5 text-primary" />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-foreground truncate leading-snug">
                        {report.purpose}
                      </p>
                      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5 group-hover:text-foreground transition-colors" />
                    </div>

                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      {report.submitter.fullName ?? report.submitter.email}
                      {report.submitter.fullName && (
                        <span className="opacity-60"> · {report.submitter.email}</span>
                      )}
                    </p>

                    <div className="flex items-center justify-between mt-2 gap-2 flex-wrap">
                      {/* Left: status + date */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={cn(
                          "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.6875rem] font-medium",
                          cfg.color,
                        )}>
                          <Icon className="w-3 h-3" />
                          {cfg.label}
                        </span>
                        <span className="text-[0.6875rem] text-muted-foreground">
                          {fmtDate(report.submittedAt ?? report.createdAt)}
                        </span>
                        {report.items.length > 0 && (
                          <span className="text-[0.6875rem] text-muted-foreground">
                            {report.items.length} {report.items.length === 1 ? "ítem" : "ítems"}
                          </span>
                        )}
                      </div>
                      {/* Right: total */}
                      <span className="text-sm font-semibold tabular-nums text-foreground">
                        {fmtCurrency(total)}
                      </span>
                    </div>

                    {/* Exception error preview */}
                    {report.status === "exception" && report.syncError && (
                      <p className="mt-1.5 text-[0.6875rem] text-destructive truncate">
                        {report.syncError}
                      </p>
                    )}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
