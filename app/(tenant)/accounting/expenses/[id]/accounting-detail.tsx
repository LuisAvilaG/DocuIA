"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  AlertCircle,
  RefreshCw,
  Loader2,
  Clock,
  User,
  Receipt,
  BadgeCheck,
} from "lucide-react";
import { EXPENSE_REPORT_STATUS } from "@/lib/status-config";

// ── Types ─────────────────────────────────────────────────────────────

interface Document {
  id: number;
  fileKey: string | null;
  mimeType: string | null;
  originalName: string | null;
}

interface Item {
  id: string;
  lineNumber: number;
  vendorName: string | null;
  vendorNit: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  expenseDate: string | null;
  subtotal: string | null;
  taxAmount: string | null;
  total: string | null;
  currency: string;
  paymentMethod: string;
  documentTypeDetected: string | null;
  needsDocumentoEquivalente: boolean;
  nsRecordType: string | null;
  nsRecordId: string | null;
  syncError: string | null;
  category: { id: number; name: string; netsuiteCategoryId: string } | null;
  department: { id: number; name: string } | null;
  class: { id: number; name: string } | null;
  documents: Document[];
}

interface Report {
  id: string;
  purpose: string;
  status: string;
  periodStart: string | null;
  periodEnd: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  rejectedReason: string | null;
  syncError: string | null;
  netsuiteExpenseReportId: string | null;
  submitter: { fullName: string | null; email: string; netsuiteEmployeeId: string | null };
  items: Item[];
}


const PAYMENT_METHOD_LABELS: Record<string, string> = {
  personal:          "Personal",
  company_pays_vendor: "Empresa paga",
};

// ── Helpers ───────────────────────────────────────────────────────────

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-CO", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

function fmtCurrency(val: string | null, currency = "COP"): string {
  return parseFloat(val ?? "0").toLocaleString("es-CO", {
    style: "currency", currency, maximumFractionDigits: 0,
  });
}

// ── Main Component ────────────────────────────────────────────────────

export function AccountingExpenseDetail({ report }: { report: Report }) {
  const router = useRouter();

  const [approving,  setApproving]  = useState(false);
  const [syncing,    setSyncing]    = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [rejecting,  setRejecting]  = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [syncError,  setSyncError]  = useState<string | null>(report.syncError ?? null);
  const [localStatus, setLocalStatus] = useState(report.status);

  const cfg  = EXPENSE_REPORT_STATUS[localStatus] ?? EXPENSE_REPORT_STATUS["submitted"];
  const Icon = cfg.icon;

  const grandTotal = report.items.reduce(
    (s, i) => s + parseFloat(i.total ?? "0"), 0,
  );

  // ── Actions ──────────────────────────────────────────────────────────

  async function handleApprove() {
    setApproving(true);
    setError(null);
    try {
      const res  = await fetch(`/api/v1/expenses/reports/${report.id}/approve`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "Error al aprobar"); return; }
      setLocalStatus("approved");
      router.refresh();
    } finally {
      setApproving(false);
    }
  }

  async function handleReject() {
    if (!rejectReason.trim()) return;
    setRejecting(true);
    setError(null);
    try {
      const res  = await fetch(`/api/v1/expenses/reports/${report.id}/reject`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ reason: rejectReason.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "Error al rechazar"); return; }
      setRejectOpen(false);
      router.push("/accounting/expenses");
    } finally {
      setRejecting(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    setError(null);
    setSyncError(null);
    try {
      const res  = await fetch(`/api/v1/expenses/reports/${report.id}/sync`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSyncError(data.error ?? "Error al sincronizar");
        setLocalStatus("exception");
        return;
      }
      setLocalStatus("synced");
      router.refresh();
    } finally {
      setSyncing(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* ── Header ── */}
      <div className="p-5 border-b border-border shrink-0">
        <button
          onClick={() => router.push("/accounting/expenses")}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-3"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Informes de gastos
        </button>

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-base font-semibold text-foreground truncate">{report.purpose}</h1>
            {(report.periodStart || report.periodEnd) && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {report.periodStart && fmtDate(report.periodStart)}
                {report.periodStart && report.periodEnd && " – "}
                {report.periodEnd && fmtDate(report.periodEnd)}
              </p>
            )}
          </div>

          <span className={cn(
            "shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium",
            cfg.color,
          )}>
            <Icon className="w-3 h-3" />
            {cfg.label}
          </span>
        </div>

        {/* Submitter info */}
        <div className="mt-3 flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <User className="w-3.5 h-3.5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-foreground truncate">
              {report.submitter.fullName ?? report.submitter.email}
            </p>
            {report.submitter.fullName && (
              <p className="text-[0.6875rem] text-muted-foreground truncate">{report.submitter.email}</p>
            )}
          </div>
          {report.submittedAt && (
            <p className="ml-auto text-[0.6875rem] text-muted-foreground shrink-0">
              Enviado {fmtDate(report.submittedAt)}
            </p>
          )}
        </div>

        {/* Rejection reason */}
        {report.rejectedReason && (
          <div className="mt-3 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
            <p className="text-xs text-destructive font-medium">Motivo del rechazo</p>
            <p className="text-xs text-destructive/80 mt-0.5">{report.rejectedReason}</p>
          </div>
        )}

        {/* Report-level sync error */}
        {localStatus === "exception" && syncError && (
          <div className="mt-3 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
            <p className="text-xs text-destructive font-medium flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5" /> Error de sincronización
            </p>
            <p className="text-xs text-destructive/70 mt-0.5">{syncError}</p>
          </div>
        )}

        {/* NetSuite ID if synced */}
        {localStatus === "synced" && report.netsuiteExpenseReportId && (
          <div className="mt-3 p-3 rounded-lg bg-success/10 border border-success/20 flex items-center gap-2">
            <BadgeCheck className="w-4 h-4 text-success shrink-0" />
            <div>
              <p className="text-xs text-success font-medium">Sincronizado en NetSuite</p>
              <p className="text-[0.6875rem] text-success/70">
                ID: {report.netsuiteExpenseReportId}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ── Items table ── */}
      <div className="flex-1 overflow-y-auto p-4">
        {report.items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Receipt className="w-8 h-8 text-muted-foreground mb-3" />
            <p className="text-sm font-medium text-foreground">Sin gastos</p>
            <p className="text-xs text-muted-foreground mt-1">Este informe no tiene líneas.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {/* Desktop table header */}
            <div className="hidden lg:grid lg:grid-cols-[2rem_1fr_1fr_1fr_1fr_1fr_6rem] gap-3 px-3 text-[0.6875rem] font-medium text-muted-foreground uppercase tracking-wide">
              <span>#</span>
              <span>Proveedor / NIT</span>
              <span>Factura</span>
              <span>Fecha</span>
              <span>Categoría</span>
              <span>Pago</span>
              <span className="text-right">Total</span>
            </div>

            {report.items.map((item) => (
              <div key={item.id} className="bg-card border border-border rounded-xl overflow-hidden">
                {/* Desktop row */}
                <div className="hidden lg:grid lg:grid-cols-[2rem_1fr_1fr_1fr_1fr_1fr_6rem] gap-3 items-center p-3 text-sm">
                  <span className="text-xs text-muted-foreground tabular-nums">{item.lineNumber}</span>

                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {item.vendorName ?? <span className="text-muted-foreground italic">Sin proveedor</span>}
                    </p>
                    {item.vendorNit && (
                      <p className="text-[0.6875rem] text-muted-foreground">{item.vendorNit}</p>
                    )}
                  </div>

                  <span className="text-xs text-muted-foreground truncate">
                    {item.invoiceNumber ? `#${item.invoiceNumber}` : "—"}
                  </span>

                  <span className="text-xs text-muted-foreground">
                    {fmtDate(item.invoiceDate ?? item.expenseDate)}
                  </span>

                  <span className="text-xs text-muted-foreground truncate">
                    {item.category?.name ?? "—"}
                  </span>

                  <span className="text-xs text-muted-foreground">
                    {PAYMENT_METHOD_LABELS[item.paymentMethod] ?? item.paymentMethod}
                  </span>

                  <div className="text-right">
                    <span className="text-sm font-semibold tabular-nums text-foreground">
                      {fmtCurrency(item.total, item.currency)}
                    </span>
                    {item.nsRecordId && (
                      <span className="mt-0.5 block text-[0.6125rem] font-medium text-success">
                        Sincronizado
                      </span>
                    )}
                  </div>
                </div>

                {/* Mobile card layout */}
                <div className="lg:hidden p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {item.vendorName ?? "Sin proveedor"}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {item.category?.name ?? "Sin categoría"}
                        {item.invoiceNumber && ` · #${item.invoiceNumber}`}
                        {item.vendorNit && ` · NIT ${item.vendorNit}`}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {fmtDate(item.invoiceDate ?? item.expenseDate)}
                        {" · "}
                        {PAYMENT_METHOD_LABELS[item.paymentMethod] ?? item.paymentMethod}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold tabular-nums text-foreground">
                        {fmtCurrency(item.total, item.currency)}
                      </p>
                      <p className="text-[0.6875rem] text-muted-foreground">#{item.lineNumber}</p>
                    </div>
                  </div>
                  {item.nsRecordId && (
                    <span className="mt-2 inline-flex items-center gap-1 text-[0.6875rem] font-medium text-success">
                      <BadgeCheck className="w-3 h-3" /> Sincronizado
                    </span>
                  )}
                </div>

                {/* Item sync error */}
                {item.syncError && (
                  <div className="px-4 pb-3">
                    <p className="text-[0.6875rem] text-destructive flex items-start gap-1">
                      <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
                      {item.syncError}
                    </p>
                  </div>
                )}
              </div>
            ))}

            {/* Grand total row */}
            <div className="flex items-center justify-between px-3 py-2.5 mt-1">
              <span className="text-sm text-muted-foreground">Total del informe</span>
              <span className="text-base font-bold tabular-nums text-foreground">
                {grandTotal.toLocaleString("es-CO", {
                  style: "currency", currency: "COP", maximumFractionDigits: 0,
                })}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ── Sticky action footer ── */}
      <div className="shrink-0 bg-card border-t border-border p-4 space-y-2">
        {error && (
          <p className="text-xs text-destructive flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {error}
          </p>
        )}

        {/* submitted → Approve + Reject */}
        {(localStatus === "submitted" || localStatus === "under_review") && (
          <div className="flex gap-2">
            <Button
              onClick={handleApprove}
              disabled={approving}
              className="flex-1 bg-success hover:bg-success/90 text-white"
            >
              {approving
                ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Aprobando…</>
                : <><CheckCircle2 className="w-4 h-4 mr-2" /> Aprobar</>}
            </Button>
            <Button
              variant="outline"
              onClick={() => setRejectOpen(true)}
              disabled={approving}
              className="flex-1 border-destructive/40 text-destructive hover:bg-destructive/10"
            >
              <XCircle className="w-4 h-4 mr-2" /> Rechazar
            </Button>
          </div>
        )}

        {/* approved → Sync to NS */}
        {localStatus === "approved" && (
          <Button
            onClick={handleSync}
            disabled={syncing}
            className="w-full"
          >
            {syncing
              ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Sincronizando…</>
              : <><RefreshCw className="w-4 h-4 mr-2" /> Sincronizar a NetSuite</>}
          </Button>
        )}

        {/* exception → Retry sync */}
        {localStatus === "exception" && (
          <Button
            onClick={handleSync}
            disabled={syncing}
            className="w-full bg-warning hover:bg-warning/90 text-white"
          >
            {syncing
              ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Reintentando…</>
              : <><RefreshCw className="w-4 h-4 mr-2" /> Reintentar sincronización</>}
          </Button>
        )}

        {/* syncing → processing state */}
        {localStatus === "syncing" && (
          <div className="flex items-center justify-center gap-2 py-2.5 text-sm text-primary">
            <Loader2 className="w-4 h-4 animate-spin" />
            Sincronizando con NetSuite…
          </div>
        )}

        {/* synced → success */}
        {localStatus === "synced" && (
          <div className="flex items-center justify-center gap-2 py-2.5 text-sm text-success">
            <BadgeCheck className="w-4 h-4" />
            {report.netsuiteExpenseReportId
              ? `Sincronizado · NS ${report.netsuiteExpenseReportId}`
              : "Sincronizado en NetSuite"}
          </div>
        )}

        {/* rejected → informational */}
        {localStatus === "rejected" && (
          <div className="flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground">
            <XCircle className="w-4 h-4" /> Informe rechazado
          </div>
        )}
      </div>

      {/* ── Reject Modal ── */}
      <Dialog open={rejectOpen} onOpenChange={(open) => setRejectOpen(open)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rechazar informe</DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Indica el motivo del rechazo. El empleado podrá verlo en su informe.
            </p>
            <Textarea
              placeholder="Motivo del rechazo…"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={4}
              className="resize-none"
            />
            {error && (
              <p className="text-xs text-destructive">{error}</p>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => { setRejectOpen(false); setRejectReason(""); }}
              disabled={rejecting}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={rejecting || !rejectReason.trim()}
            >
              {rejecting
                ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Rechazando…</>
                : "Confirmar rechazo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
