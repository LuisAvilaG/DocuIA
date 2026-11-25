"use client";

// Documento generado del caso: se ve a la izquierda tal como se descarga, y a la
// derecha están las descargas, los datos que quedaron vacíos y regenerar. Antes
// la pestaña era una franja con dos enlaces y el resto de la pantalla vacío.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Document, Page, pdfjs } from "react-pdf";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { OutputDownloads } from "./output-downloads";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

const MAX_PAGE_WIDTH = 860;
const row = "flex flex-col gap-2 border-t border-border py-4 text-[13.5px] first-of-type:border-foreground";
const label = "text-[11.5px] font-semibold uppercase tracking-[0.05em] text-foreground/75";
const hint = "text-[12.5px] text-muted-foreground";

export function CaseOutput({ caseId, name, isWord, missing, canRegenerate, stamp }: {
  caseId: string;
  /** File name of the generated document. */
  name: string | null;
  isWord: boolean;
  /** Fields the template asked for and the case did not have, already readable. */
  missing: string[];
  canRegenerate: boolean;
  /** When the case last changed: a regenerated document is never read from the browser's cache. */
  stamp: number;
}) {
  const router = useRouter();
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(1);
  // Changes after regenerating, so the preview reads the new document.
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.floor(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  async function regenerate() {
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/v1/contracts/cases/${caseId}/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) { setError(data.error ?? "No se pudo regenerar el documento."); return; }
      setPage(1); setPages(0); setVersion((v) => v + 1);
      router.refresh();
    } catch {
      setError("No se pudo conectar con DocuIA. Revisa tu conexión e inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_372px]">
      <div className="flex min-w-0 flex-col bg-[#E9E6E0] lg:min-h-0">
        <div className="flex flex-wrap items-center gap-2.5 border-b border-border bg-[#F4F2EE] px-4 py-2.5 text-[13px]">
          <b className="min-w-0 truncate font-semibold">{name || "Documento generado"}</b>
          {pages > 0 && (
            <span className="ml-auto flex items-center gap-2.5">
              <span className="tabular-nums text-muted-foreground">Página {page} de {pages}</span>
              <button type="button" aria-label="Página anterior" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="flex size-[30px] items-center justify-center rounded-md border border-[#D6D2C8] bg-card disabled:opacity-40"><ChevronLeft className="size-4" /></button>
              <button type="button" aria-label="Página siguiente" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="flex size-[30px] items-center justify-center rounded-md border border-[#D6D2C8] bg-card disabled:opacity-40"><ChevronRight className="size-4" /></button>
            </span>
          )}
        </div>
        <div className="min-w-0 overflow-auto p-5.5 lg:min-h-0 lg:flex-1">
          <div ref={frame} className="min-w-0">
            <Document key={version} file={`/api/v1/contracts/cases/${caseId}/output?format=pdf&v=${stamp}-${version}`} onLoadSuccess={(pdf) => setPages(pdf.numPages)}
              loading={<p className="py-10 text-center text-[13px] text-muted-foreground">Preparando la vista previa…</p>}
              error={<p className="py-10 text-center text-[13px] text-muted-foreground">No se pudo mostrar la vista previa. Descarga el documento para verlo.</p>}>
              <div className="mx-auto w-fit shadow-[0_2px_16px_rgba(30,32,41,0.14)]">
                <Page pageNumber={Math.min(page, pages || page)} width={Math.min(width, MAX_PAGE_WIDTH)} renderAnnotationLayer={false} renderTextLayer={false} />
              </div>
            </Document>
          </div>
        </div>
      </div>

      <section aria-labelledby="out-h" className="flex min-w-0 flex-col px-6 pb-6 pt-5.5 md:px-6.5 lg:min-h-0 lg:overflow-y-auto">
        <h2 id="out-h" className="mb-3 text-[17px] font-semibold tracking-[-0.015em]">Documento generado</h2>
        <div className={row}>
          <span className="inline-flex items-center gap-2.5 text-base font-semibold tracking-[-0.01em]"><span aria-hidden className="size-[9px] shrink-0 rounded-full bg-tone-ok" />Listo</span>
          <span className={hint}>Lo que ves a la izquierda es el documento tal como se descarga.</span>
        </div>
        <div className={row}>
          <span className={label}>Descargar</span>
          <OutputDownloads caseId={caseId} hasWord={isWord} variant="buttons" />
        </div>
        {missing.length > 0 && (
          <div className={row}>
            <span className={cn(label, "text-tone-warn")}>Quedaron sin dato · {missing.length}</span>
            <ul className="flex flex-col gap-1">
              {missing.slice(0, 8).map((field) => <li key={field}>{field}</li>)}
              {missing.length > 8 && <li className={hint}>y {missing.length - 8} más</li>}
            </ul>
            <Link href="?etapa=docs" className="text-[13px] font-semibold text-link hover:underline">Completar en Documentos</Link>
          </div>
        )}
        {canRegenerate && (
          <div className={row}>
            <span>
              <button type="button" onClick={() => void regenerate()} disabled={busy} className="inline-flex items-center gap-1.5 font-semibold text-link hover:underline disabled:opacity-50">
                {busy && <Loader2 className="size-3.5 animate-spin" />}{busy ? "Regenerando…" : "Regenerar documento"}
              </button>
              <span className={cn("block", hint)}>Lo vuelve a armar con los datos actuales del caso.</span>
            </span>
            {error && <p role="alert" className="text-[13px] text-tone-err">{error}</p>}
          </div>
        )}
      </section>
    </div>
  );
}

/** Before there is a document: when it will be generated and, if it can be done now, the button. */
export function GenerateOutput({ caseId, note, canGenerate }: { caseId: string; note: string; canGenerate: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/v1/contracts/cases/${caseId}/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) { setError(data.error ?? "No se pudo generar el documento."); return; }
      router.refresh();
    } catch {
      setError("No se pudo conectar con DocuIA. Revisa tu conexión e inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-sm text-muted-foreground">{note}</p>
      {canGenerate && (
        <button type="button" onClick={() => void generate()} disabled={busy} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4.5 text-sm font-semibold text-primary-foreground hover:bg-link disabled:opacity-50">
          {busy && <Loader2 className="size-4 animate-spin" />}{busy ? "Generando…" : "Generar documento"}
        </button>
      )}
      {error && <p role="alert" className="text-[13px] text-tone-err">{error}</p>}
    </div>
  );
}
