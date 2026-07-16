"use client";

import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { X, Download, ExternalLink, ScrollText, ZoomIn, ZoomOut, ChevronLeft, ChevronRight, FileSearch } from "lucide-react";

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

const pretty = (k: string) => k.replace(/[_.]/g, " ").replace(/\s+/g, " ").trim().replace(/^\w/, (c) => c.toUpperCase());
const flat = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean).join(", ") : v === null || v === undefined || v === "" ? "—" : String(v));
function citationOf(cites: Record<string, unknown>, key: string): string | null {
  const c = cites[key];
  if (c === null || c === undefined || c === "") return null;
  if (Array.isArray(c)) { const s = c.map((x) => String(x)).filter(Boolean).join("  •  "); return s || null; }
  return String(c) || null;
}
function docKind(mime: string | null, hasText: boolean): "pdf" | "image" | "text" {
  const m = (mime ?? "").toLowerCase();
  if (m.includes("pdf")) return "pdf";
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("text/") || m.includes("xml") || hasText) return "text";
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
      <mark ref={markRef} style={{ background: "oklch(0.9 0.12 85)", color: "inherit", borderRadius: 2, padding: "0 1px" }}>{text.slice(i, i + len)}</mark>
      {text.slice(i + len)}
    </>
  );
}

function DocViewer({ doc, onClose }: { doc: CaseDoc; onClose: () => void }) {
  const fileUrl = `/api/v1/contracts/documents/${doc.id}/file`;
  const entries = Object.entries(doc.extractedJson ?? {});
  const [selected, setSelected] = useState<string | null>(entries[0]?.[0] ?? null);
  const [numPages, setNumPages] = useState(0);
  const [pageNum, setPageNum] = useState(1);
  const [scale, setScale] = useState(1);
  const markRef = useRef<HTMLElement | null>(null);
  const kind = docKind(doc.mimeType, !!doc.detectedText);
  const citation = selected ? citationOf(doc.citationsJson ?? {}, selected) : null;

  useEffect(() => { markRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }); }, [selected]);

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onMouseDown={onClose}>
      <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-5xl h-[92vh] flex flex-col overflow-hidden" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <ScrollText className="w-4 h-4 text-muted-foreground shrink-0" />
            <p className="text-sm font-medium text-foreground truncate">{doc.originalName || "Documento"}</p>
            {doc.detectedType && <span className="text-[11px] text-primary bg-primary/10 px-2 py-0.5 rounded-full shrink-0">{doc.detectedType}</span>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <a href={fileUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"><ExternalLink className="w-3.5 h-3.5" /> Abrir</a>
            <a href={fileUrl} download className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"><Download className="w-3.5 h-3.5" /> Descargar</a>
            <button onClick={onClose} className="h-8 w-8 flex items-center justify-center rounded hover:bg-secondary text-muted-foreground"><X className="w-4 h-4" /></button>
          </div>
        </div>

        <div className="flex-1 flex min-h-0">
          {/* Document */}
          <div className="flex-1 min-w-0 flex flex-col border-r border-border">
            {kind === "pdf" && (
              <div className="px-3 py-1.5 border-b border-border flex items-center gap-2 shrink-0">
                {numPages > 1 && (<>
                  <button onClick={() => setPageNum((p) => Math.max(1, p - 1))} disabled={pageNum <= 1} className="w-6 h-6 flex items-center justify-center rounded hover:bg-secondary text-muted-foreground disabled:opacity-30"><ChevronLeft className="w-3.5 h-3.5" /></button>
                  <span className="text-[11px] text-muted-foreground tabular-nums">{pageNum}/{numPages}</span>
                  <button onClick={() => setPageNum((p) => Math.min(numPages, p + 1))} disabled={pageNum >= numPages} className="w-6 h-6 flex items-center justify-center rounded hover:bg-secondary text-muted-foreground disabled:opacity-30"><ChevronRight className="w-3.5 h-3.5" /></button>
                  <div className="w-px h-3.5 bg-border mx-0.5" />
                </>)}
                <button onClick={() => setScale((s) => Math.max(0.5, +(s - 0.2).toFixed(2)))} className="w-6 h-6 flex items-center justify-center rounded hover:bg-secondary text-muted-foreground"><ZoomOut className="w-3.5 h-3.5" /></button>
                <span className="text-[11px] text-muted-foreground tabular-nums w-9 text-center">{Math.round(scale * 100)}%</span>
                <button onClick={() => setScale((s) => Math.min(3, +(s + 0.2).toFixed(2)))} className="w-6 h-6 flex items-center justify-center rounded hover:bg-secondary text-muted-foreground"><ZoomIn className="w-3.5 h-3.5" /></button>
              </div>
            )}
            <div className="flex-1 overflow-auto p-4 flex justify-center" style={{ background: "oklch(0.94 0.01 258)" }}>
              {kind === "pdf" && (
                <Document file={fileUrl} onLoadSuccess={({ numPages }) => setNumPages(numPages)}
                  loading={<p className="text-xs text-muted-foreground mt-10">Cargando documento…</p>}
                  error={<p className="text-xs text-muted-foreground mt-10">No se pudo cargar. Usa “Abrir”.</p>}>
                  <div style={{ boxShadow: "0 2px 16px oklch(0.18 0.015 258 / 0.14)", borderRadius: 4, overflow: "hidden" }}>
                    <Page pageNumber={pageNum} width={520 * scale} renderTextLayer={false} renderAnnotationLayer={false} />
                  </div>
                </Document>
              )}
              {kind === "image" && <img src={fileUrl} alt={doc.originalName || "Documento"} style={{ maxWidth: "100%", height: "auto", boxShadow: "0 2px 16px oklch(0.18 0.015 258 / 0.14)", borderRadius: 4 }} />}
              {kind === "text" && (
                <pre className="w-full whitespace-pre-wrap text-[12px] leading-relaxed text-foreground bg-card rounded-lg border border-border p-4 font-sans">
                  {doc.detectedText ? <Highlighted text={doc.detectedText} needle={citation} markRef={markRef} /> : "No hay texto para previsualizar. Usa “Abrir” o “Descargar”."}
                </pre>
              )}
            </div>
          </div>

          {/* Fields + origin */}
          <div className="w-80 shrink-0 flex flex-col">
            <div className="px-4 py-2.5 border-b border-border shrink-0"><p className="text-xs font-semibold text-foreground">Datos del documento</p><p className="text-[11px] text-muted-foreground">Selecciona un dato para ver su origen.</p></div>
            <div className="flex-1 overflow-y-auto">
              {entries.length === 0 && <p className="px-4 py-4 text-xs text-muted-foreground">Sin datos.</p>}
              {entries.map(([k, v]) => {
                const active = selected === k;
                return (
                  <button key={k} onClick={() => setSelected(k)}
                    className={`w-full text-left px-4 py-2.5 border-b border-border/60 transition-colors ${active ? "bg-primary/5" : "hover:bg-secondary/50"}`}>
                    <p className="text-[10px] font-medium uppercase tracking-[0.06em] text-muted-foreground">{pretty(k)}</p>
                    <p className="text-xs text-foreground mt-0.5 break-words">{flat(v)}</p>
                    {active && (
                      <p className="text-[11px] text-muted-foreground mt-1.5 border-l-2 border-primary/40 pl-2 break-words">
                        {citationOf(doc.citationsJson ?? {}, k) ? <>Origen: “{citationOf(doc.citationsJson ?? {}, k)}”{kind === "text" && doc.detectedText ? " · resaltado en el documento" : ""}</> : "Sin referencia registrada."}
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function CaseDocuments({ documents }: { documents: CaseDoc[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = documents.find((d) => d.id === openId) ?? null;

  return (
    <>
      <div className="space-y-4">
        {documents.length === 0 && <p className="text-xs text-muted-foreground">Sin documentos.</p>}
        {documents.map((d) => {
          const entries = Object.entries(d.extractedJson ?? {});
          return (
            <div key={d.id} className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-border flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{d.originalName || "Documento"}</p>
                  {d.detectedType && <span className="text-[11px] text-muted-foreground">{d.detectedType}</span>}
                </div>
                <button onClick={() => setOpenId(d.id)} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[11px] font-medium text-foreground hover:bg-secondary shrink-0">
                  <FileSearch className="w-3.5 h-3.5" /> Ver en el documento
                </button>
              </div>
              {entries.length === 0 ? (
                <p className="px-5 py-4 text-xs text-muted-foreground">Sin datos.</p>
              ) : (
                <dl className="p-5 grid sm:grid-cols-2 gap-x-5 gap-y-3">
                  {entries.map(([k, v]) => (
                    <div key={k} className="min-w-0">
                      <dt className="text-[10px] font-medium uppercase tracking-[0.06em] text-muted-foreground">{pretty(k)}</dt>
                      <dd className="text-xs text-foreground mt-0.5 break-words">{flat(v)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          );
        })}
      </div>
      {open && <DocViewer doc={open} onClose={() => setOpenId(null)} />}
    </>
  );
}
