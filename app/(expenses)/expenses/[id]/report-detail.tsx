"use client";

// Un informe de gastos: la tabla de gastos (fecha, subtotal, impuesto, total) y
// al lado el recibo del gasto elegido. Antes cada gasto era una tarjeta suelta
// y el recibo no se veía en esta pantalla.
import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Receipt } from "lucide-react";
import { cn } from "@/lib/utils";
import { btn, StatusPill } from "@/components/kit";
import { formatExpenseAmount, formatExpenseTotals } from "@/lib/expense/totals";

// pdf.js loads only when a PDF receipt is shown.
const ReceiptPdf = dynamic(() => import("@/components/expense/receipt-pdf").then((m) => m.ReceiptPdf), {
  ssr: false,
  loading: () => <p className="p-6 text-center text-[13px] text-muted-foreground">Cargando recibo…</p>,
});

const STATUS = {
  draft:        { label: "Borrador",      tone: "mute" },
  submitted:    { label: "Enviado",       tone: "info" },
  under_review: { label: "En revisión",   tone: "warn" },
  approved:     { label: "Aprobado",      tone: "ok" },
  rejected:     { label: "Rechazado",     tone: "err" },
  syncing:      { label: "Sincronizando", tone: "info" },
  synced:       { label: "En el ERP",     tone: "ok" },
  exception:    { label: "Error",         tone: "err" },
} as const;

interface Item {
  id: string; lineNumber: number;
  vendorName: string | null; invoiceNumber: string | null;
  expenseDate: Date | string | null; invoiceDate: Date | string | null;
  subtotal: string | null; taxAmount: string | null; total: string | null; currency: string;
  documentTypeDetected: string | null;
  needsDocumentoEquivalente: boolean;
  category: { name: string } | null;
  documents: { id: number; originalName: string | null; ocrConfidence: string | null; mimeType: string | null; hasFile: boolean }[];
}

interface Report {
  id: string; purpose: string; status: keyof typeof STATUS;
  periodStart: string | null; periodEnd: string | null;
  rejectedReason: string | null; submittedAt: string | null;
  items: Item[];
}

const day = (value: Date | string | null, year = false) => (value ? new Date(value).toLocaleDateString("es-CO", { day: "2-digit", month: "short", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" }) : null);
const amount = (value: string | null, currency: string) => (value === null || value === "" ? "—" : formatExpenseAmount(parseFloat(value) || 0, currency || "COP"));
const lowConfidence = (item: Item) => Boolean(item.documents[0]?.ocrConfidence && parseFloat(item.documents[0].ocrConfidence) < 0.6);

export function ReportDetail({ report, isAdmin, isOwner }: { report: Report; isAdmin: boolean; isOwner: boolean }) {
  const router  = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [reopening,  setReopening]  = useState(false);
  const [notice,     setNotice]     = useState<string | null>(null);
  const [deleting,   setDeleting]   = useState<string | null>(null);
  const [error,      setError]      = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // A draft is edited by its owner (or an administrator), as the API allows:
  // a reviewer who opens it saw buttons that only answered "No autorizado".
  const isDraft = report.status === "draft" && (isOwner || isAdmin);
  const status  = STATUS[report.status] ?? STATUS.draft;
  const selected = report.items.find((item) => item.id === selectedId) ?? report.items[0] ?? null;
  const receipt = selected?.documents.find((d) => d.hasFile) ?? null;
  const toCheck = report.items.filter((item) => lowConfidence(item) || item.needsDocumentoEquivalente).length;

  async function handleSubmit() {
    setSubmitting(true); setError(null);
    try {
      const res  = await fetch(`/api/v1/expenses/reports/${report.id}/submit`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "Error al enviar"); return; }
      if (data.syncError) setNotice(data.syncError);
      router.refresh();
    } catch {
      setError("No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReopen() {
    setReopening(true); setError(null);
    const res  = await fetch(`/api/v1/expenses/reports/${report.id}/reopen`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setReopening(false);
    if (!res.ok) { setError(data.error ?? "No se pudo reabrir el informe"); return; }
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
      setSelectedId(null);
      router.refresh();
    } catch {
      setError("Error de conexión al eliminar");
    } finally {
      setDeleting(null);
    }
  }

  const period = [day(report.periodStart), day(report.periodEnd, true)].filter(Boolean).join(" – ");

  return (
    <div className="flex flex-1 flex-col overflow-y-auto lg:overflow-hidden">
      <div className="shrink-0 px-6 pb-4.5 pt-5.5 md:px-8">
        <nav aria-label="Ruta" className="text-[13px]"><Link href="/expenses" className="text-link hover:underline">Mis gastos</Link><span className="text-muted-foreground"> / Informe</span></nav>
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="mt-1.5 text-2xl font-semibold leading-tight tracking-[-0.025em]">{report.purpose}</h1>
              <StatusPill tone={status.tone}>{status.label}</StatusPill>
            </div>
            <p className="mt-1.5 text-[13px] text-muted-foreground">
              {period && <>{period} · </>}
              {report.items.length} gasto{report.items.length === 1 ? "" : "s"}
              {report.items.length > 0 && <> · <b className="font-semibold text-foreground">total {formatExpenseTotals(report.items)}</b></>}
              {toCheck > 0 && <> · {toCheck} por revisar</>}
            </p>
          </div>
          {isDraft && (
            <div className="mt-1.5 flex flex-wrap gap-2.5">
              <Link href={`/expenses/${report.id}/item/new`} className={btn(report.items.length ? "secondary" : "primary")}>Agregar gasto</Link>
              {report.items.length > 0 && (
                <button type="button" onClick={() => void handleSubmit()} disabled={submitting} className={btn("primary")}>
                  {submitting && <Loader2 className="animate-spin" />}Enviar a aprobación
                </button>
              )}
            </div>
          )}
        </div>

        {report.rejectedReason && (
          <div role="alert" className="mt-3.5 rounded-xl border border-[#E9C6C2] bg-tone-err-bg px-4 py-3 text-[13.5px]">
            <b className="font-semibold text-tone-err">Motivo del rechazo.</b> {report.rejectedReason}{" "}
            {report.status === "rejected" && (isOwner || isAdmin) && (
              <button type="button" onClick={() => void handleReopen()} disabled={reopening} className="inline-flex items-center gap-1.5 font-semibold text-link hover:underline disabled:opacity-50">
                {reopening && <Loader2 className="size-3.5 animate-spin" />}Corregir y volver a enviar
              </button>
            )}
          </div>
        )}
        {notice && <p className="mt-3 text-[13px] text-tone-warn">{notice}</p>}
        {error && <p role="alert" className="mt-3 text-[13px] text-tone-err">{error}</p>}
      </div>

      {report.items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center border-t border-border px-6 py-16 text-center">
          <Receipt aria-hidden className="mb-3 size-8 text-muted-foreground" />
          <p className="text-sm font-semibold">Este informe todavía no tiene gastos</p>
          <p className="mt-1 text-[13px] text-muted-foreground">{isDraft ? "Agrega el primero con la foto o el PDF del recibo." : "No se registraron gastos en este informe."}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 border-t border-border lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <div className="min-w-0 px-6 pb-7 pt-4.5 md:pl-8 md:pr-7 lg:min-h-0 lg:overflow-y-auto">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13.5px]">
                <thead>
                  <tr>
                    {(["Fecha", "Gasto", "Subtotal", "Impuesto", "Total"] as const).map((h, i) => (
                      <th key={h} scope="col" className={cn("whitespace-nowrap border-b border-border px-3 py-[9px] text-[11.5px] font-semibold uppercase tracking-[0.05em] text-foreground/75 first:pl-1 last:pr-1", i > 1 ? "text-right" : "text-left")}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.items.map((item) => {
                    const on = item.id === selected?.id;
                    return (
                      <tr key={item.id} onClick={() => setSelectedId(item.id)} aria-selected={on}
                        className={cn("cursor-pointer border-b border-line-soft [&>td]:px-3 [&>td]:py-2.5 [&>td]:align-top [&>td:first-child]:pl-1 [&>td:last-child]:pr-1", on ? "bg-[#FFFBF2]" : "hover:bg-secondary/40")}>
                        <td className="whitespace-nowrap tabular-nums">{day(item.expenseDate ?? item.invoiceDate) ?? "—"}</td>
                        <td>
                          <button type="button" onClick={(e) => { e.stopPropagation(); setSelectedId(item.id); }} className={cn("text-left", on && "font-semibold")}>{item.vendorName ?? "Proveedor no identificado"}</button>
                          <small className="block text-[12.5px] text-muted-foreground">{[item.category?.name ?? "Sin categoría", item.invoiceNumber && `#${item.invoiceNumber}`].filter(Boolean).join(" · ")}</small>
                          {lowConfidence(item) && <small className="block text-[12.5px] font-semibold text-tone-warn">Lectura dudosa: revisa los datos</small>}
                          {item.needsDocumentoEquivalente && <small className="block text-[12.5px] font-semibold text-tone-warn">Requiere documento equivalente</small>}
                        </td>
                        <td className="whitespace-nowrap text-right tabular-nums">{amount(item.subtotal, item.currency)}</td>
                        <td className="whitespace-nowrap text-right tabular-nums">{amount(item.taxAmount, item.currency)}</td>
                        <td className="whitespace-nowrap text-right font-semibold tabular-nums">{amount(item.total, item.currency)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap justify-between gap-4 pt-3 text-[13.5px]">
              <span className="text-[12.5px] text-muted-foreground">Toca un gasto para ver su recibo</span>
              <b className="font-semibold tabular-nums">Total {formatExpenseTotals(report.items)}</b>
            </div>
          </div>

          {selected && (
            <div className="flex min-w-0 flex-col border-t border-border bg-[#E9E6E0] lg:min-h-0 lg:border-l lg:border-t-0">
              <div className="flex flex-wrap items-center gap-2.5 border-b border-border bg-[#F4F2EE] px-4 py-2.5 text-[13px]">
                <b className="min-w-0 truncate font-semibold">Recibo de {selected.vendorName ?? "proveedor no identificado"}</b>
                <span className="ml-auto flex items-center gap-3.5">
                  {receipt && <a href={`/api/v1/expenses/documents/${receipt.id}/file`} download className="font-semibold text-link hover:underline">Descargar</a>}
                  {isDraft && (
                    <button type="button" onClick={() => void handleDelete(selected.id)} disabled={deleting === selected.id} className="inline-flex items-center gap-1.5 font-semibold text-tone-err hover:underline disabled:opacity-50">
                      {deleting === selected.id && <Loader2 className="size-3.5 animate-spin" />}Quitar gasto
                    </button>
                  )}
                </span>
              </div>
              <div className="min-w-0 overflow-auto p-5.5 lg:min-h-0 lg:flex-1">
                {!receipt ? (
                  <p className="py-10 text-center text-[13px] text-muted-foreground">Este gasto no tiene recibo adjunto.</p>
                ) : receipt.mimeType === "application/pdf" ? (
                  <ReceiptPdf key={receipt.id} url={`/api/v1/expenses/documents/${receipt.id}/file`} maxWidth={480} />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={receipt.id} src={`/api/v1/expenses/documents/${receipt.id}/file`} alt={`Recibo de ${selected.vendorName ?? "este gasto"}`} className="mx-auto block max-w-full shadow-[0_2px_16px_rgba(30,32,41,0.14)]" />
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
