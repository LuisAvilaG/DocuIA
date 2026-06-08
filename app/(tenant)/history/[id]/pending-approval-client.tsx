"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  ChevronLeft, CheckCircle2, XCircle, Loader2, ShieldCheck, ExternalLink,
} from "lucide-react";

interface Line {
  description: string;
  quantity: number | null;
  rate: number | null;
  amount: number | null;
  selected_item_id: string | null;
  selected_unit_id: string | null;
}

interface Props {
  docId:    number;
  vendor:   string | null;
  numDoc:   string | null;
  total:    string | null;
  docType:  string;
  lines:    Line[];
  isAdmin:  boolean;
}

const DOC_LABELS: Record<string, string> = {
  invoice: "Factura", purchase_order: "Orden de compra", xml_cfdi: "CFDI XML",
};

export function PendingApprovalClient({ docId, vendor, numDoc, total, docType, lines, isAdmin }: Props) {
  const router  = useRouter();
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");
  const [result,   setResult]   = useState<{ netsuiteId: string | null; recordUrl: string | null } | null>(null);

  async function approve() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/workflow/${docId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ _approval: true }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Error al aprobar"); return; }
      setResult({ netsuiteId: data.netsuiteId ?? null, recordUrl: data.recordUrl ?? null });
    } catch {
      setError("No se pudo conectar con el servidor");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
    {/* ── Result modal ──────────────────────────────────────────────────── */}
    {result !== null && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ backgroundColor: "oklch(0.18 0.015 258 / 0.55)" }}
      >
        <div
          className="bg-card border border-border rounded-2xl w-full max-w-md overflow-hidden"
          style={{ boxShadow: "0 24px 64px oklch(0.18 0.015 258 / 0.2), 0 4px 16px oklch(0.18 0.015 258 / 0.1)" }}
        >
          <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
            <div className="w-8 h-8 rounded-full bg-emerald-500/15 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-foreground">Documento aprobado y enviado a NetSuite</p>
              <p className="text-xs text-muted-foreground mt-0.5">La transacción fue creada exitosamente</p>
            </div>
          </div>
          <div className="px-5 py-4 space-y-3">
            {result.netsuiteId && (
              <div className="flex items-center justify-between gap-3 py-2 border-b border-border/60">
                <span className="text-xs text-muted-foreground">ID NetSuite</span>
                <span className="text-xs font-mono font-semibold text-foreground bg-secondary px-2 py-0.5 rounded">
                  {result.netsuiteId}
                </span>
              </div>
            )}
            <div className="flex items-center justify-between gap-3 py-2 border-b border-border/60">
              <span className="text-xs text-muted-foreground">Num. Doc</span>
              <span className="text-xs font-medium text-foreground">{numDoc ?? `#${docId}`}</span>
            </div>
            <div className="flex items-center justify-between gap-3 py-2">
              <span className="text-xs text-muted-foreground">Proveedor</span>
              <span className="text-xs font-medium text-foreground truncate max-w-[180px]">{vendor ?? "—"}</span>
            </div>
          </div>
          <div className="px-5 py-4 border-t border-border flex items-center gap-2.5">
            {result.recordUrl && (
              <a
                href={result.recordUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-border text-xs font-medium text-foreground hover:bg-secondary transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Ver en NetSuite
              </a>
            )}
            <button
              onClick={() => router.push(`/history/${docId}`)}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors"
            >
              Ver documento
            </button>
          </div>
        </div>
      </div>
    )}

    <div className="flex-1 flex flex-col overflow-auto">
      {/* Header */}
      <div className="h-14 border-b border-border px-6 flex items-center gap-3 shrink-0">
        <Link href="/history" className="text-muted-foreground hover:text-foreground transition-colors">
          <ChevronLeft className="w-4 h-4" />
        </Link>
        <div className="flex-1">
          <h1 className="text-sm font-semibold text-foreground">
            {DOC_LABELS[docType] ?? docType} #{docId}
          </h1>
          <p className="text-xs text-muted-foreground">Pendiente de aprobación</p>
        </div>
        <span className="text-xs font-medium px-2.5 py-1 rounded-full border bg-amber-400/10 text-amber-400 border-amber-400/20">
          Aprobación requerida
        </span>
      </div>

      <div className="flex-1 p-6 max-w-2xl mx-auto w-full space-y-5">

        {/* Summary */}
        <div className="bg-card border border-border rounded-xl p-5 space-y-3">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Resumen del documento
          </h2>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-[11px] text-muted-foreground mb-0.5">Proveedor</p>
              <p className="text-sm font-medium text-foreground">{vendor ?? "—"}</p>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground mb-0.5">Num. Doc</p>
              <p className="text-sm font-medium text-foreground">{numDoc ?? "—"}</p>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground mb-0.5">Total</p>
              <p className="text-sm font-semibold text-foreground">
                {total ? `$${Number(total).toLocaleString("es-MX", { minimumFractionDigits: 2 })}` : "—"}
              </p>
            </div>
          </div>
        </div>

        {/* Lines */}
        {lines.length > 0 && (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="text-sm font-medium text-foreground">Líneas ({lines.length})</h2>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-secondary/30">
                  {["Descripción", "Cant.", "P. Unit.", "Total", "Item NS"].map(h => (
                    <th key={h} className="px-3 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {lines.map((l, i) => (
                  <tr key={i} className="hover:bg-accent/20 transition-colors">
                    <td className="px-3 py-2.5 text-foreground max-w-[200px]">
                      <p className="truncate">{l.description}</p>
                    </td>
                    <td className="px-3 py-2.5 tabular-nums text-foreground">{l.quantity ?? "—"}</td>
                    <td className="px-3 py-2.5 tabular-nums text-foreground">
                      {l.rate !== null ? `$${l.rate.toLocaleString("es-MX", { minimumFractionDigits: 2 })}` : "—"}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums font-medium text-foreground">
                      {l.amount !== null ? `$${l.amount.toLocaleString("es-MX", { minimumFractionDigits: 2 })}` : "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      {l.selected_item_id ? (
                        <span className="text-primary bg-primary/10 px-1.5 py-0.5 rounded font-mono text-[10px]">
                          {l.selected_item_id}
                        </span>
                      ) : (
                        <span className="text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded text-[10px]">
                          Sin mapear
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Actions */}
        {isAdmin ? (
          <div className="bg-card border border-border rounded-xl p-5 space-y-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="w-3.5 h-3.5" />
              El documento fue procesado correctamente y está listo para enviarse a NetSuite.
            </div>
            {error && (
              <div className="flex items-center gap-2 text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
                <XCircle className="w-3.5 h-3.5 shrink-0" />
                {error}
              </div>
            )}
            <button
              onClick={approve}
              disabled={loading}
              className={cn(
                "w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all",
                "bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            >
              {loading
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Enviando a NetSuite...</>
                : <><CheckCircle2 className="w-4 h-4" /> Aprobar y enviar a NetSuite</>
              }
            </button>
          </div>
        ) : (
          <div className="bg-amber-400/5 border border-amber-400/20 rounded-xl p-4 text-center">
            <p className="text-sm text-amber-400 font-medium">Pendiente de aprobación</p>
            <p className="text-xs text-muted-foreground mt-1">
              Un administrador debe aprobar este documento antes de enviarlo a NetSuite.
            </p>
          </div>
        )}
      </div>
    </div>
    </>
  );
}
