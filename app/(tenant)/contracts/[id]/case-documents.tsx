"use client";

// Documentos del caso: el documento a la izquierda y sus datos leídos a la
// derecha, cada mitad con su desplazamiento. Al tocar un dato se ve de dónde
// salió (la cita se resalta en la página) y, si el rol lo permite, se corrige
// ahí mismo. Antes los datos eran una lista en letra pequeña y el documento
// solo se veía en una ventana aparte.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Document, Page, pdfjs } from "react-pdf";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { btn } from "@/components/kit";
import { matchQuote, type Box, type WordBox } from "@/lib/contracts/evidence";
import { pageWords, type PdfTextDoc } from "@/lib/contracts/pdf-words";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

export interface CaseDoc {
  id: string;
  originalName: string | null;
  mimeType: string | null;
  detectedType: string | null;
  extractedJson: Record<string, unknown>;
  citationsJson: Record<string, unknown>;
  detectedText: string | null;
}

const MAX_SCAN_PAGES = 80;
const MAX_PAGE_WIDTH = 860;
const pretty = (k: string) => k.replace(/[_.]/g, " ").replace(/\s+/g, " ").trim().replace(/^\w/, (c) => c.toUpperCase());
const flat = (v: unknown) => (Array.isArray(v) ? v.map((x) => (typeof x === "object" && x !== null ? Object.values(x).join(" · ") : String(x))).filter(Boolean).join(", ") : v === null || v === undefined ? "" : String(v));
/** Citations of a field: one, or one per element of a list. */
function citationsOf(cites: Record<string, unknown>, key: string): string[] {
  const c = cites[key];
  if (c === null || c === undefined || c === "") return [];
  return (Array.isArray(c) ? c : [c]).map((x) => String(x).trim()).filter(Boolean);
}
function docKind(mime: string | null): "pdf" | "image" | "text" {
  const m = (mime ?? "").toLowerCase();
  if (m.includes("pdf")) return "pdf";
  if (m.startsWith("image/")) return "image";
  return "text";
}

// Highlight the first occurrence of a citation (matched on a tolerant prefix).
function Highlighted({ text, needle, markRef }: { text: string; needle: string | null; markRef: React.RefObject<HTMLElement | null> }) {
  if (!needle) return <>{text}</>;
  const probe = needle.trim().slice(0, 40).toLowerCase();
  const i = probe ? text.toLowerCase().indexOf(probe) : -1;
  if (i < 0) return <>{text}</>;
  const len = Math.min(needle.length, 160);
  return (
    <>
      {text.slice(0, i)}
      <mark ref={markRef} className="rounded-sm bg-tone-warn-bg px-px text-inherit shadow-[0_0_0_2px_#EBD9AE]">{text.slice(i, i + len)}</mark>
      {text.slice(i + len)}
    </>
  );
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.floor(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** `canTrain`: administrators, the only role the API lets correct a value (and save it for future documents). */
export function CaseDocuments({ documents, canTrain = false }: { documents: CaseDoc[]; canTrain?: boolean }) {
  const router = useRouter();
  const [overrides, setOverrides] = useState<Record<string, CaseDoc>>({});
  const docs = documents.map((document) => overrides[document.id] ?? document);
  const [docId, setDocId] = useState(docs[0]?.id ?? null);
  const doc = docs.find((d) => d.id === docId) ?? docs[0] ?? null;
  const entries = Object.entries(doc?.extractedJson ?? {});
  const [selected, setSelected] = useState<string | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(1);
  // Where the citation of the chosen datum is on the document: page and position.
  const [spot, setSpot] = useState<{ key: string; page: number; box: Box } | null>(null);
  const [searching, setSearching] = useState(false);
  const pdfRef = useRef<{ id: string; pdf: PdfTextDoc; words: Map<number, WordBox[]> } | null>(null);
  const markRef = useRef<HTMLElement | null>(null);
  const [frameRef, width] = useWidth<HTMLDivElement>();
  const [editing, setEditing] = useState(false);
  const [editedValue, setEditedValue] = useState("");
  const [applyToFuture, setApplyToFuture] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const kind = doc ? docKind(doc.mimeType) : "text";
  const fileUrl = doc ? `/api/v1/contracts/documents/${doc.id}/file` : "";
  const citations = doc && selected ? citationsOf(doc.citationsJson ?? {}, selected) : [];
  const quote = citations[0] ?? null;

  // The quote is looked for on the pages of the PDF (its own text layer).
  const locate = useCallback(async (key: string, text: string) => {
    const loaded = pdfRef.current;
    if (!loaded) return;
    setSearching(true);
    try {
      for (let n = 1; n <= Math.min(loaded.pdf.numPages, MAX_SCAN_PAGES); n++) {
        if (!loaded.words.has(n)) loaded.words.set(n, await pageWords(loaded.pdf, n).catch(() => []));
        if (pdfRef.current !== loaded) return;
        const box = matchQuote(loaded.words.get(n)!, text);
        if (box) { setSpot({ key, page: n, box }); setPage(n); return; }
      }
      setSpot(null);
    } finally {
      setSearching(false);
    }
  }, []);

  function choose(key: string) {
    if (saving) return;
    if (editing && key !== selected) setEditing(false);
    setSelected(key);
    setSpot(null);
    const first = doc ? citationsOf(doc.citationsJson ?? {}, key)[0] : undefined;
    if (first && kind === "pdf") void locate(key, first);
  }

  function openDoc(id: string) {
    setDocId(id); setSelected(null); setSpot(null); setEditing(false); setPage(1); setNumPages(0);
    pdfRef.current = null;
  }

  // Text documents: the highlighted citation is scrolled into view.
  useEffect(() => { markRef.current?.scrollIntoView({ block: "center" }); }, [selected, docId]);
  const spotRef = useRef<HTMLSpanElement>(null);
  useEffect(() => { spotRef.current?.scrollIntoView({ block: "nearest" }); }, [spot, page]);

  function startEditing(key: string) {
    if (!doc) return;
    const current = doc.extractedJson[key];
    setSelected(key);
    setEditedValue(current === null || current === undefined ? "" : String(current));
    setApplyToFuture(false);
    setEditError(null);
    setEditing(true);
  }

  async function saveCorrection() {
    if (!doc || !selected || !editedValue.trim()) return;
    setSaving(true); setEditError(null);
    try {
      const response = await fetch(`/api/v1/contracts/documents/${doc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fieldKey: selected, value: editedValue.trim(), applyToFuture }),
      });
      const payload = await response.json() as { error?: string; extractedJson?: Record<string, unknown> };
      if (!response.ok || !payload.extractedJson) throw new Error(payload.error || "No se pudo guardar la corrección.");
      setOverrides((current) => ({ ...current, [doc.id]: { ...doc, extractedJson: payload.extractedJson! } }));
      setEditing(false);
      router.refresh();
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "No se pudo guardar la corrección.");
    } finally {
      setSaving(false);
    }
  }

  if (!doc) return <p className="px-6 py-5.5 text-sm text-muted-foreground md:px-8">Este caso no tiene documentos.</p>;

  const shown = spot && spot.key === selected && spot.page === page ? spot : null;
  const hasCitations = entries.some(([key]) => citationsOf(doc.citationsJson ?? {}, key).length > 0);

  return (
    <div className="grid grid-cols-1 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col bg-[#E9E6E0] lg:min-h-0">
        <div className="flex flex-wrap items-center gap-2.5 border-b border-border bg-[#F4F2EE] px-4 py-2.5 text-[13px]">
          {docs.length > 1 ? (
            <div role="tablist" aria-label="Documentos del caso" className="flex min-w-0 flex-wrap gap-1.5">
              {docs.map((d) => (
                <button key={d.id} role="tab" aria-selected={d.id === doc.id} type="button" onClick={() => openDoc(d.id)}
                  className={cn("max-w-[220px] truncate rounded-md border px-2.5 py-1 text-[12.5px]", d.id === doc.id ? "border-primary bg-card font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
                  {d.originalName || d.detectedType || "Documento"}
                </button>
              ))}
            </div>
          ) : <b className="min-w-0 truncate font-semibold">{doc.originalName || "Documento"}</b>}
          <span className="ml-auto flex items-center gap-2.5">
            {kind === "pdf" && numPages > 0 && (
              <>
                <span className="tabular-nums text-muted-foreground">Página {Math.min(page, numPages)} de {numPages}</span>
                <button type="button" aria-label="Página anterior" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="flex size-[30px] items-center justify-center rounded-md border border-[#D6D2C8] bg-card disabled:opacity-40"><ChevronLeft className="size-4" /></button>
                <button type="button" aria-label="Página siguiente" disabled={page >= numPages} onClick={() => setPage((p) => p + 1)} className="flex size-[30px] items-center justify-center rounded-md border border-[#D6D2C8] bg-card disabled:opacity-40"><ChevronRight className="size-4" /></button>
              </>
            )}
            <a href={fileUrl} download className="font-semibold text-link hover:underline">Descargar</a>
          </span>
        </div>
        <div className="min-w-0 overflow-auto p-5.5 lg:min-h-0 lg:flex-1">
          <div ref={frameRef} className="min-w-0">
            {kind === "pdf" ? (
              <Document key={doc.id} file={fileUrl}
                onLoadSuccess={(pdf) => {
                  setNumPages(pdf.numPages);
                  pdfRef.current = { id: doc.id, pdf: pdf as unknown as PdfTextDoc, words: new Map() };
                  if (selected && quote) void locate(selected, quote);
                }}
                loading={<p className="text-[13px] text-muted-foreground">Cargando documento…</p>}
                error={<p className="text-[13px] text-muted-foreground">No se pudo mostrar el documento. Descárgalo para abrirlo.</p>}>
                <div className="relative mx-auto w-fit shadow-[0_2px_16px_rgba(30,32,41,0.14)]">
                  <Page pageNumber={Math.min(page, numPages || page)} width={Math.min(width, MAX_PAGE_WIDTH)} renderAnnotationLayer={false} renderTextLayer={false} />
                  {shown && <span ref={spotRef} aria-hidden className="pointer-events-none absolute scroll-my-16 rounded-sm bg-[#B07C0E]/15 outline outline-[1.5px] outline-[#B07C0E]" style={{ left: `${shown.box.x1 * 100}%`, top: `${shown.box.y1 * 100}%`, width: `${(shown.box.x2 - shown.box.x1) * 100}%`, height: `${(shown.box.y2 - shown.box.y1) * 100}%` }} />}
                </div>
              </Document>
            ) : kind === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={fileUrl} alt={doc.originalName || "Documento"} className="mx-auto block max-w-full shadow-[0_2px_16px_rgba(30,32,41,0.14)]" />
            ) : (
              <pre className="mx-auto w-full max-w-[760px] whitespace-pre-wrap rounded-lg border border-border bg-card p-5 font-sans text-[13px] leading-relaxed">
                {doc.detectedText ? <Highlighted text={doc.detectedText} needle={quote} markRef={markRef} /> : "No hay texto para mostrar. Descarga el documento para abrirlo."}
              </pre>
            )}
          </div>
        </div>
      </div>

      <section aria-labelledby="docs-data" className="flex min-w-0 flex-col px-6 pb-6 pt-5 md:px-6.5 lg:min-h-0 lg:overflow-y-auto">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-foreground pb-2.5">
          <h2 id="docs-data" className="text-[15px] font-semibold">{entries.length} dato{entries.length === 1 ? "" : "s"} leído{entries.length === 1 ? "" : "s"}</h2>
          <span className="text-[12.5px] text-muted-foreground">{[doc.detectedType ? pretty(doc.detectedType) : null, hasCitations ? "toca un dato para ver de dónde salió" : null].filter(Boolean).join(" · ")}</span>
        </div>
        {entries.length === 0 && <p className="py-4 text-[13.5px] text-muted-foreground">No se leyó ningún dato de este documento.</p>}
        <ul>
          {entries.map(([key, raw]) => {
            const on = key === selected;
            const value = flat(raw);
            const cites = citationsOf(doc.citationsJson ?? {}, key);
            const editable = canTrain && !Array.isArray(raw);
            return (
              <li key={key} className={cn("border-b border-line-soft", on && "bg-[#FFFBF2]")}>
                <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_84px] items-baseline gap-x-3 px-1 py-2.5 text-[13.5px]">
                  <button type="button" onClick={() => choose(key)} aria-expanded={on} className={cn("min-w-0 text-left", on && "font-semibold")}>{pretty(key)}</button>
                  <span className={cn("min-w-0 break-words font-semibold tabular-nums", !value && "text-tone-warn")}>{value || "Sin dato"}</span>
                  {editable
                    ? <button type="button" onClick={() => startEditing(key)} className="text-right text-link hover:underline">{value ? "Corregir" : "Completar"}</button>
                    : <span />}
                </div>
                {on && !editing && (
                  <p className="px-1 pb-2.5 text-[13px] text-foreground/75">
                    {cites.length === 0 ? <span className="text-muted-foreground">Sin referencia registrada en el documento.</span> : (
                      <>
                        <span className="italic">«{cites.join("»  ·  «")}»</span>
                        {kind === "pdf" && <span className="text-muted-foreground"> · {searching ? "buscando en el documento…" : spot?.key === key ? `p. ${spot.page}` : "no se ubicó en el documento"}</span>}
                      </>
                    )}
                  </p>
                )}
                {on && editing && (
                  <div className="flex flex-col gap-2.5 px-1 pb-3">
                    <label className="flex flex-col gap-1.5 text-[12.5px] text-foreground/75">Valor correcto
                      <textarea rows={2} value={editedValue} onChange={(event) => setEditedValue(event.target.value)}
                        className="w-full resize-y rounded-lg border border-[#D6D2C8] bg-white px-3 py-2 text-[13.5px] text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
                    </label>
                    {doc.detectedType && (
                      <label className="flex items-start gap-2 text-[12.5px] text-muted-foreground">
                        <input type="checkbox" checked={applyToFuture} onChange={(event) => setApplyToFuture(event.target.checked)} className="mt-0.5 size-4 accent-primary" />
                        <span><b className="font-semibold text-foreground">Aplicar a futuros documentos de este tipo.</b> Guarda la corrección como ejemplo aprobado.</span>
                      </label>
                    )}
                    {editError && <p role="alert" className="text-[12.5px] text-tone-err">{editError}</p>}
                    <div className="flex flex-wrap justify-end gap-2">
                      <button type="button" onClick={() => setEditing(false)} disabled={saving} className={btn("secondary", "sm")}>Cancelar</button>
                      <button type="button" onClick={() => void saveCorrection()} disabled={saving || !editedValue.trim()} className={btn("primary", "sm")}>
                        {saving && <Loader2 className="animate-spin" />}{applyToFuture ? "Guardar y aprender" : "Guardar corrección"}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {canTrain && entries.length > 0 && <p className="mt-3 text-[12.5px] text-muted-foreground">Al corregir un dato se recalculan las validaciones y los cálculos del caso.</p>}
      </section>
    </div>
  );
}
