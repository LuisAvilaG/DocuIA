import type { ComponentType } from "react";
import { Clock, CheckCircle2, XCircle, RefreshCw, AlertCircle, Loader2 } from "lucide-react";

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

// Document pipeline statuses — shared by workflow and history pages
export const DOC_STATUS: Record<string, DocStatusEntry> = {
  uploaded:         { label: "Subido",     color: "text-muted-foreground", bg: "bg-muted",          icon: Clock },
  extracting:       { label: "Extrayendo", color: "text-warning",          bg: "bg-warning/10",      icon: Loader2 },
  review:           { label: "Revisión",   color: "text-warning",          bg: "bg-warning/10",      icon: Clock },
  pending_approval: { label: "Aprobación", color: "text-warning",          bg: "bg-warning/10",      icon: Clock },
  approved:         { label: "Aprobado",   color: "text-primary",          bg: "bg-primary/10",      icon: CheckCircle2 },
  processing:       { label: "Procesando", color: "text-warning",          bg: "bg-warning/10",      icon: Loader2 },
  completed:        { label: "Completado", color: "text-success",          bg: "bg-success/10",      icon: CheckCircle2 },
  failed:           { label: "Error",      color: "text-destructive",      bg: "bg-destructive/10",  icon: XCircle },
};

// Expense report statuses — shared by accounting list and detail pages
export const EXPENSE_REPORT_STATUS: Record<string, ExpenseStatusEntry> = {
  submitted:    { label: "Pendiente",     color: "bg-warning/10 text-warning",          icon: Clock },
  under_review: { label: "En revisión",   color: "bg-primary/10 text-primary",          icon: Clock },
  approved:     { label: "Aprobado",      color: "bg-success/10 text-success",          icon: CheckCircle2 },
  rejected:     { label: "Rechazado",     color: "bg-muted text-muted-foreground",      icon: XCircle },
  syncing:      { label: "Sincronizando", color: "bg-primary/10 text-primary",          icon: RefreshCw },
  synced:       { label: "En NetSuite",   color: "bg-success/10 text-success",          icon: CheckCircle2 },
  exception:    { label: "Error sync",    color: "bg-destructive/10 text-destructive",  icon: AlertCircle },
};
