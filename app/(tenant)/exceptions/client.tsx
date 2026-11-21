"use client";

import { useInBrowser } from "@/lib/use-in-browser";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { btn, EmptyState, PageFrame, StatusPill, type BtnVariant } from "@/components/kit";
import type { Tone } from "@/lib/status-vocabulary";
import { friendlyError } from "@/lib/ap/friendly-error";

export interface ExRow {
  id: number;
  documentId: number | null; numDoc: string | null; vendor: string | null; total: number | null;
  documentType: string | null; originalFilename: string | null;
  failureStage: string; failureReason: string | null; errorCode: string | null;
  status: string; retryCount: number; lastRetryAt: string | null; canRetry: boolean; createdAt: string;
}

const FILTERS = [
  { key: "pending",     label: "Pendientes" },
  { key: "in_progress", label: "En proceso" },
  { key: "resolved",    label: "Resueltas" },
  { key: "dismissed",   label: "Descartadas" },
] as const;

const STAGE: Record<string, { label: string; tone: Tone }> = {
  extract:  { label: "Lectura",      tone: "warn" },
  validate: { label: "Validación",   tone: "warn" },
  process:  { label: "Envío al ERP", tone: "err" },
};

const DOC_LABEL: Record<string, string> = { invoice: "Factura", purchase_order: "Orden de compra", xml_cfdi: "CFDI" };

function when(iso: string): string {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  const mins = Math.floor((Date.now() - d.getTime()) / 60_000);
  if (mins < 60) return mins < 1 ? "ahora" : `hace ${mins} min`;
  if (days === 0) return `hace ${Math.floor(mins / 60)} h`;
  if (days === 1) return "ayer";
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}

const title = (e: ExRow) => [e.numDoc ?? e.originalFilename ?? `Excepción ${e.id}`, e.vendor].filter(Boolean).join(" · ");
const reason = (e: ExRow) => friendlyError(e.failureReason?.split("\n")[0]) ?? "Sin descripción del error";

export function ExceptionsClient({ exceptions: initial, canAct }: { exceptions: ExRow[]; canAct: boolean }) {
  const inBrowser = useInBrowser();
  const [rows, setRows] = useState(initial);
  const [filter, setFilter] = useState<string>("pending");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.key, rows.filter((r) => r.status === f.key).length])), [rows]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => r.status === filter && (!q || [r.originalFilename, r.numDoc, r.vendor, r.errorCode, r.failureReason].some((v) => v?.toLowerCase().includes(q))));
  }, [rows, filter, search]);
  const selected = shown.find((r) => r.id === selectedId) ?? shown[0] ?? null;

  async function act(e: ExRow, kind: "retry" | "resolve" | "dismiss") {
    setBusy(kind); setError("");
    try {
      const res = kind === "retry"
        ? await fetch(`/api/v1/exceptions/${e.id}/retry`, { method: "POST" })
        : await fetch(`/api/v1/exceptions/${e.id}/resolve`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(kind === "dismiss" ? { dismiss: true } : {}),
        });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "No se pudo completar la acción."); return; }
      const next = kind === "dismiss" ? "dismissed"
        : kind === "resolve" ? "resolved"
        : data.result?.status && data.result.status !== "failed" ? "resolved" : "pending";
      setRows((prev) => prev.map((r) => (r.id === e.id ? { ...r, status: next, retryCount: kind === "retry" ? r.retryCount + 1 : r.retryCount, lastRetryAt: kind === "retry" ? new Date().toISOString() : r.lastRetryAt } : r)));
      if (kind === "retry" && next === "pending") setError("El reintento volvió a fallar. El motivo se actualiza al recargar.");
    } catch {
      setError("No se pudo conectar al servidor.");
    } finally {
      setBusy(null);
    }
  }

  const open = selected && (selected.status === "pending" || selected.status === "in_progress");

  return (
    <PageFrame>
      <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.025em]">Excepciones</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">Documentos que no pudieron seguir solos. Cada uno dice qué pasó y cómo salir.</p>

      <div className="mt-4.5 flex flex-wrap items-center gap-2.5">
        <div role="group" aria-label="Estado" className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => { setFilter(f.key); setSelectedId(null); setError(""); }}
              className={cn("min-h-[34px] rounded-full border px-3 text-[13px] font-medium transition-colors",
                filter === f.key ? "border-foreground bg-foreground text-background" : "border-[#D6D2C8] bg-white text-foreground/75 hover:text-foreground")}>
              {f.label} <span className="tabular-nums">{counts[f.key]}</span>
            </button>
          ))}
        </div>
        <label className="relative ml-auto w-full min-w-[260px] sm:w-[300px]">
          <span className="sr-only">Buscar</span>
          <Search aria-hidden className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por archivo o error"
            className="min-h-10 w-full rounded-lg border border-[#D6D2C8] bg-white pl-9 pr-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" />
        </label>
      </div>

      {shown.length === 0 ? (
        <EmptyState className="mt-4.5" title={rows.length === 0 ? "Sin excepciones" : search ? "Nada coincide con la búsqueda" : `No hay excepciones ${FILTERS.find((f) => f.key === filter)?.label.toLowerCase()}`}>
          {rows.length === 0 ? "Cuando un documento no pueda seguir solo aparecerá aquí con su motivo." : "Prueba con otro estado o búsqueda."}
        </EmptyState>
      ) : (
        <div className="mt-4.5 grid overflow-hidden rounded-xl border border-border bg-card lg:min-h-[560px] lg:grid-cols-[400px_minmax(0,1fr)]">
          <ul className="border-b border-border lg:border-b-0 lg:border-r">
            {shown.map((e) => {
              const on = selected?.id === e.id;
              return (
                <li key={e.id}>
                  <button type="button" onClick={() => { setSelectedId(e.id); setError(""); }} aria-current={on || undefined}
                    className={cn("grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-2.5 gap-y-1 border-b border-line-soft px-4.5 py-3.5 text-left transition-colors", on ? "bg-[#FBF4F3]" : "hover:bg-secondary/40")}>
                    <b className="truncate text-sm font-semibold">{title(e)}</b>
                    <small className="text-xs text-muted-foreground">{inBrowser ? when(e.createdAt) : ""}</small>
                    <span className="col-span-2 truncate text-[13px] text-foreground/80">{reason(e)}</span>
                    <small className="col-span-2 text-xs text-muted-foreground">
                      {STAGE[e.failureStage]?.label ?? e.failureStage}{e.retryCount > 0 ? ` · ${e.retryCount} reintento${e.retryCount === 1 ? "" : "s"}` : ""}
                    </small>
                  </button>
                </li>
              );
            })}
          </ul>

          {selected && (
            <section aria-labelledby="exc-title" className="flex flex-col gap-4.5 px-7 py-6">
              <div>
                <StatusPill tone={STAGE[selected.failureStage]?.tone ?? "warn"}>{STAGE[selected.failureStage]?.label ?? selected.failureStage}</StatusPill>
                <h2 id="exc-title" className="mt-2 text-xl font-semibold tracking-[-0.015em]">{reason(selected)}</h2>
              </div>
              {selected.failureReason && selected.failureReason.includes("\n") && (
                <p className="whitespace-pre-line text-[15px]">{selected.failureReason.split("\n").slice(1).join("\n")}</p>
              )}
              <dl className="grid grid-cols-[140px_minmax(0,1fr)] gap-x-3.5 gap-y-2 text-[13.5px]">
                <dt className="text-muted-foreground">Documento</dt>
                <dd>
                  {selected.documentId
                    ? <Link href={`/history/${selected.documentId}`} className="text-link hover:underline">{[selected.numDoc ?? `#${selected.documentId}`, DOC_LABEL[selected.documentType ?? ""], selected.total != null ? selected.total.toLocaleString("es-MX", { style: "currency", currency: "MXN" }) : null].filter(Boolean).join(" · ")}</Link>
                    : selected.originalFilename ?? "—"}
                </dd>
                {selected.originalFilename && selected.documentId && <><dt className="text-muted-foreground">Archivo</dt><dd className="break-all">{selected.originalFilename}</dd></>}
                {selected.errorCode && <><dt className="text-muted-foreground">Código</dt><dd className="font-mono text-[13px]">{selected.errorCode}</dd></>}
                <dt className="text-muted-foreground">Reintentos</dt>
                <dd>{selected.retryCount === 0 ? "Ninguno" : `${selected.retryCount}${selected.lastRetryAt && inBrowser ? ` · ${new Date(selected.lastRetryAt).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}`}</dd>
                <dt className="text-muted-foreground">Llegó</dt>
                <dd>{inBrowser ? new Date(selected.createdAt).toLocaleString("es-MX", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}</dd>
              </dl>

              {error && <p role="alert" className="text-sm text-tone-err">{error}</p>}

              <div className="flex flex-wrap gap-2 border-t border-line-soft pt-4">
                {selected.documentId && <Link href={`/history/${selected.documentId}`} className={btn("secondary")}>Abrir el documento</Link>}
                {open && canAct && (
                  <>
                    {selected.canRetry && <ActBtn variant="primary" busy={busy === "retry"} disabled={busy !== null} onClick={() => act(selected, "retry")}>Reintentar</ActBtn>}
                    <ActBtn variant="text" busy={busy === "resolve"} disabled={busy !== null} onClick={() => act(selected, "resolve")}>Marcar resuelto</ActBtn>
                    <ActBtn variant="text" busy={busy === "dismiss"} disabled={busy !== null} onClick={() => act(selected, "dismiss")}>Descartar</ActBtn>
                  </>
                )}
              </div>
              {open && canAct && <p className="-mt-2 text-xs text-muted-foreground">Descartar la saca de la lista sin procesarla, por ejemplo si era un archivo equivocado.</p>}
            </section>
          )}
        </div>
      )}
    </PageFrame>
  );
}

function ActBtn({ variant, busy, disabled, onClick, children }: { variant: BtnVariant; busy: boolean; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className={btn(variant)} disabled={disabled} onClick={onClick}>
      {busy && <Loader2 className="animate-spin" />}{children}
    </button>
  );
}
