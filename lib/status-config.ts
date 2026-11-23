import type { ComponentType } from "react";
import { Clock, CheckCircle2, XCircle, RefreshCw, AlertCircle, Loader2, PackageSearch } from "lucide-react";
import { AP_STATUS, TONE_PILL } from "./status-vocabulary";

type Icon = ComponentType<{ className?: string }>;

export interface DocStatusEntry {
  label: string;
  color: string;
  bg: string;
  icon: Icon;
}

export interface ExpenseStatusEntry {
  label: string;
  color: string;
  icon: Icon;
}

// Document pipeline statuses — shared by workflow and history pages.
// Labels and tones come from the single 2026 vocabulary (lib/status-vocabulary.ts).
const DOC_ICONS: Record<string, Icon> = {
  uploaded: Loader2, extracting: Loader2, review: Clock, pending_approval: Clock,
  approved: CheckCircle2, processing: Loader2, completed: CheckCircle2, failed: XCircle,
  awaiting_receipt: PackageSearch,
};

export const DOC_STATUS: Record<string, DocStatusEntry> = Object.fromEntries(
  Object.entries(AP_STATUS).map(([key, word]) => {
    const [bg, color] = TONE_PILL[word.tone].split(" ");
    return [key, { label: word.label, color, bg, icon: DOC_ICONS[key] ?? Clock }];
  }),
);

// Expense report statuses — shared by accounting list and detail pages
export const EXPENSE_REPORT_STATUS: Record<string, ExpenseStatusEntry> = {
  submitted:    { label: "Pendiente",     color: "bg-warning/10 text-warning",          icon: Clock },
  under_review: { label: "En revisión",   color: "bg-primary/10 text-primary",          icon: Clock },
  approved:     { label: "Aprobado",      color: "bg-success/10 text-success",          icon: CheckCircle2 },
  rejected:     { label: "Rechazado",     color: "bg-muted text-muted-foreground",      icon: XCircle },
  syncing:      { label: "Sincronizando", color: "bg-primary/10 text-primary",          icon: RefreshCw },
  synced:       { label: "En el ERP",     color: "bg-success/10 text-success",          icon: CheckCircle2 },
  exception:    { label: "Error sync",    color: "bg-destructive/10 text-destructive",  icon: AlertCircle },
};
