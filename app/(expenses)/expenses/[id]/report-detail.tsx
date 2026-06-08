"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  PlusCircle, Trash2, Receipt, CheckCircle2, XCircle,
  AlertCircle, Clock, Send, Loader2, FileText,
} from "lucide-react";

const STATUS_CONFIG = {
  draft:        { label: "Borrador",      color: "text-muted-foreground bg-muted" },
  submitted:    { label: "Enviado",       color: "text-primary bg-primary/10" },
  under_review: { label: "En revisión",   color: "text-warning bg-warning/10" },
  approved:     { label: "Aprobado",      color: "text-success bg-success/10" },
  rejected:     { label: "Rechazado",     color: "text-destructive bg-destructive/10" },
  syncing:      { label: "Sincronizando", color: "text-primary bg-primary/10" },
  synced:       { label: "En NetSuite",   color: "text-success bg-success/10" },
  exception:    { label: "Error",         color: "text-destructive bg-destructive/10" },
} as const;

interface Item {
  id: string; lineNumber: number;
  vendorName: string | null; invoiceNumber: string | null;
  subtotal: string | null; total: string | null; currency: string;
  documentTypeDetected: string | null;
  needsDocumentoEquivalente: boolean;
  category: { name: string } | null;
  documents: { id: number; originalName: string | null; ocrConfidence: string | null }[];
}

interface Report {
  id: string; purpose: string; status: keyof typeof STATUS_CONFIG;
  periodStart: string | null; periodEnd: string | null;
  rejectedReason: string | null; submittedAt: string | null;
  items: Item[];
}

export function ReportDetail({ report, isAdmin }: { report: Report; isAdmin: boolean }) {
  const router  = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [deleting,   setDeleting]   = useState<string | null>(null);
  const [error,      setError]      = useState<string | null>(null);

  const isDraft = report.status === "draft";
  const total   = report.items.reduce((s, i) => s + parseFloat(i.total ?? "0"), 0);
  const cfg     = STATUS_CONFIG[report.status] ?? STATUS_CONFIG.draft;
  const currencies = [...new Set(report.items.map(i => i.currency ?? "COP"))];
  const displayCurrency = currencies.length === 1 ? currencies[0] : null;

  async function handleSubmit() {
    setSubmitting(true); setError(null);
    const res  = await fetch(`/api/v1/expenses/reports/${report.id}/submit`, { method: "POST" });
    const data = await res.json();
    setSubmitting(false);
    if (!res.ok) { setError(data.error ?? "Error al enviar"); return; }
    router.refresh();
  }

  async function handleDelete(itemId: string) {
    setDeleting(itemId);
    try {
      const res = await fetch(`/api/v1/expenses/items/${itemId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "No se pudo eliminar el gasto");
        return;
      }
      router.refresh();
    } catch {
      setError("Error de conexión al eliminar");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Header */}
      <div className="p-5 border-b border-border">
        <a href="/expenses" className="text-xs text-muted-foreground hover:text-foreground transition-colors">← Mis gastos</a>
        <div className="flex items-start justify-between mt-2 gap-3">
          <div className="min-w-0">
            <h1 className="text-base font-semibold text-foreground truncate">{report.purpose}</h1>
            {(report.periodStart || report.periodEnd) && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {report.periodStart && new Date(report.periodStart).toLocaleDateString("es-CO", { day: "2-digit", month: "short" })}
                {report.periodStart && report.periodEnd && " – "}
                {report.periodEnd && new Date(report.periodEnd).toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" })}
              </p>
            )}
          </div>
          <span className={cn("shrink-0 inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium", cfg.color)}>
            {cfg.label}
          </span>
        </div>

        {report.rejectedReason && (
          <div className="mt-3 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
            <p className="text-xs text-destructive font-medium">Motivo del rechazo</p>
            <p className="text-xs text-destructive/80 mt-0.5">{report.rejectedReason}</p>
          </div>
        )}
      </div>

      {/* Items */}
      <div className="p-5 space-y-3">
        {report.items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Receipt className="w-8 h-8 text-muted-foreground mb-3" />
            <p className="text-sm text-foreground font-medium">Sin gastos</p>
            <p className="text-xs text-muted-foreground mt-1">Agrega el primer gasto a este informe.</p>
          </div>
        ) : (
          report.items.map((item) => (
            <div key={item.id} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    <FileText className="w-4 h-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {item.vendorName ?? "Proveedor no identificado"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {item.category?.name ?? "Sin categoría"}
                      {item.invoiceNumber && ` · #${item.invoiceNumber}`}
                    </p>
                    {item.needsDocumentoEquivalente && (
                      <span className="mt-1.5 inline-flex items-center gap-1 text-[0.6875rem] text-warning font-medium">
                        <AlertCircle className="w-3 h-3" /> Requiere documento equivalente
                      </span>
                    )}
                    {item.documents[0]?.ocrConfidence && parseFloat(item.documents[0].ocrConfidence) < 0.6 && (
                      <span className="mt-1 inline-flex items-center gap-1 text-[0.6875rem] text-warning font-medium">
                        <AlertCircle className="w-3 h-3" /> Confianza OCR baja — verifica los datos
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <p className="text-sm font-semibold tabular-nums text-foreground">
                    {parseFloat(item.total ?? "0").toLocaleString("es-CO", { style: "currency", currency: item.currency ?? "COP", maximumFractionDigits: 0 })}
                  </p>
                  {isDraft && (
                    <button
                      onClick={() => handleDelete(item.id)}
                      disabled={deleting === item.id}
                      className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                    >
                      {deleting === item.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))
        )}

        {/* Add expense button */}
        {isDraft && (
          <Link
            href={`/expenses/${report.id}/item/new`}
            className="flex items-center justify-center gap-2 w-full py-3 rounded-xl border-2 border-dashed border-border text-sm text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors"
          >
            <PlusCircle className="w-4 h-4" />
            Agregar gasto
          </Link>
        )}
      </div>

      {/* Footer — total + submit */}
      {report.items.length > 0 && (
        <div className="sticky bottom-0 bg-card border-t border-border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Total del informe</span>
            <span className="text-base font-semibold tabular-nums text-foreground">
              {displayCurrency
                ? total.toLocaleString("es-CO", { style: "currency", currency: displayCurrency, maximumFractionDigits: 0 })
                : total.toLocaleString("es-CO", { maximumFractionDigits: 0 })}
            </span>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          {isDraft && (
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Enviar para aprobación
            </button>
          )}
        </div>
      )}
    </div>
  );
}
