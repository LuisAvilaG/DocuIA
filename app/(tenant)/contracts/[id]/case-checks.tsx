"use client";

// Validaciones sobre el documento: los hallazgos se numeran, se dibujan sobre la
// página donde está la cita y se explican en la lista de la derecha.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { ChevronLeft, ChevronRight, CheckCircle2, MinusCircle } from "lucide-react";
import { matchQuote, type Box, type EvidenceRef, type WordBox } from "@/lib/contracts/evidence";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

export interface CheckDoc { id: string; name: string; kind: "pdf" | "image" | "other" }
export interface CheckFinding {
  id: number; ruleName: string; severity: "info" | "warn" | "block"; subject: string; status: string;
  ok: boolean | null; reason: string; ai: boolean; evidence: EvidenceRef[];
}
export interface CheckPassed { id: number; ruleName: string; subject: string; status: string }

type Located = { docId: string; page: number; box: Box | null };
type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage> };
type PdfPage = { view: number[]; getTextContent: () => Promise<{ items: Array<{ str?: string; transform?: number[]; width?: number; height?: number }> }> };

const MAX_SCAN_PAGES = 80;
const TONE = { block: "#B3261E", warn: "#B07C0E", unknown: "#6B6560" } as const;
const toneOf = (f: CheckFinding) => (f.ok === false && f.severity === "block" ? "block" : f.ok === false || f.severity === "block" ? "warn" : "unknown");
const severityText = (f: CheckFinding) => f.ok === false && f.severity === "block" ? "Bloquea la aprobación" : f.ok === false ? "A revisar" : "No se pudo verificar";

/** Palabras con posición (0–1) de una página, desde la capa de texto del PDF. */
async function pageWords(pdf: PdfDoc, n: number): Promise<WordBox[]> {
  const page = await pdf.getPage(n);
  const [vx, vy, vx2, vy2] = page.view;
  const W = vx2 - vx, H = vy2 - vy;
  const { items } = await page.getTextContent();
  const out: WordBox[] = [];
  for (const it of items) {
    if (!it.str || !it.transform || !it.width) continue;
    const [, , c, d, e, f] = it.transform;
    const fontH = Math.hypot(c, d) || it.height || 10;
    const len = it.str.length;
    const re = /\S+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(it.str))) {
      const x1 = e - vx + it.width * (m.index / len);
      const x2 = e - vx + it.width * ((m.index + m[0].length) / len);
      out.push({ text: m[0], x1: x1 / W, x2: x2 / W, y1: 1 - (f - vy + fontH * 0.85) / H, y2: 1 - (f - vy - fontH * 0.2) / H });
    }
  }
  return out;
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

export function CaseChecks({ docs, findings, passed }: { docs: CheckDoc[]; findings: CheckFinding[]; passed: CheckPassed[] }) {
  const [active, setActive] = useState<number | null>(findings[0]?.id ?? null);
  const [docId, setDocId] = useState<string | null>(() => findings.flatMap((f) => f.evidence).find((e) => e.documentId)?.documentId ?? docs[0]?.id ?? null);
  const [page, setPage] = useState(() => findings[0]?.evidence.find((e) => e.page)?.page ?? 1);
  const [numPages, setNumPages] = useState(0);
  const [located, setLocated] = useState<Record<string, Located>>({});
  const [showPassed, setShowPassed] = useState(false);
  const [frameRef, width] = useWidth<HTMLDivElement>();
  const scanned = useRef(new Set<string>());

  const doc = docs.find((d) => d.id === docId) ?? null;
  const numberOf = useMemo(() => new Map(findings.map((f, i) => [f.id, i + 1])), [findings]);
  const nameOf = useMemo(() => new Map(docs.map((d) => [d.id, d.name])), [docs]);

  // Ubicación de cada cita: la calculada en el visor, o la página guardada.
  const whereIs = useCallback((f: CheckFinding, i: number): Located | null => {
    const found = located[`${f.id}:${i}`];
    if (found) return found;
    const e = f.evidence[i];
    return e.documentId && e.page ? { docId: e.documentId, page: e.page, box: null } : null;
  }, [located]);

  const onPdfLoad = useCallback(async (pdf: PdfDoc, forDoc: string) => {
    setNumPages(pdf.numPages);
    if (scanned.current.has(forDoc)) return;
    scanned.current.add(forDoc);
    const cache = new Map<number, WordBox[]>();
    const words = async (n: number) => { if (!cache.has(n)) cache.set(n, await pageWords(pdf, n).catch(() => [])); return cache.get(n)!; };
    const found: Record<string, Located> = {};
    for (const f of findings) {
      for (const [i, e] of f.evidence.entries()) {
        if (e.documentId && e.documentId !== forDoc) continue;
        const pages = e.page && e.documentId === forDoc ? [e.page] : Array.from({ length: Math.min(pdf.numPages, MAX_SCAN_PAGES) }, (_, k) => k + 1);
        for (const n of pages) {
          const box = matchQuote(await words(n), e.quote);
          if (box) { found[`${f.id}:${i}`] = { docId: forDoc, page: n, box }; break; }
        }
      }
    }
    setLocated((prev) => ({ ...prev, ...found }));
  }, [findings]);

  function goTo(id: string, n: number) {
    if (id !== docId) setNumPages(0);
    setDocId(id); setPage(n);
  }

  function select(f: CheckFinding) {
    setActive(f.id);
    const first = f.evidence.map((_, i) => whereIs(f, i)).find(Boolean);
    if (first) goTo(first.docId, first.page);
  }

  function openDoc(id: string) { goTo(id, 1); }

  // Marcadores de la página visible.
  const marks = findings.flatMap((f) => f.evidence.map((_, i) => ({ f, at: whereIs(f, i) })))
    .filter((m): m is { f: CheckFinding; at: Located } => !!m.at && m.at.docId === docId && m.at.page === page);
  const inDoc = new Set(findings.filter((f) => f.evidence.some((_, i) => whereIs(f, i)?.docId === docId)).map((f) => f.id)).size;

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex min-w-0 flex-col gap-3">
        {docs.length > 1 && (
          <div role="tablist" aria-label="Documentos del caso" className="flex flex-wrap gap-1.5">
            {docs.map((d) => (
              <button key={d.id} role="tab" aria-selected={d.id === docId} type="button" onClick={() => openDoc(d.id)}
                className={`max-w-[240px] truncate rounded-md border px-2.5 py-1 text-[12.5px] ${d.id === docId ? "border-primary bg-primary/5 font-semibold text-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}>
                {d.name}
              </button>
            ))}
          </div>
        )}
        {doc && (
          <div className="flex items-center justify-between gap-3 text-[12.5px] text-muted-foreground">
            <span>{doc.kind === "pdf" && numPages ? `Página ${page} de ${numPages}` : doc.name}{inDoc ? ` · ${inDoc} hallazgo${inDoc === 1 ? "" : "s"} en este documento` : ""}</span>
            {doc.kind === "pdf" && numPages > 1 && (
              <span className="flex gap-1">
                <button type="button" aria-label="Página anterior" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="flex size-7 items-center justify-center rounded-md border border-border disabled:opacity-40"><ChevronLeft className="size-4" /></button>
                <button type="button" aria-label="Página siguiente" disabled={page >= numPages} onClick={() => setPage((p) => p + 1)} className="flex size-7 items-center justify-center rounded-md border border-border disabled:opacity-40"><ChevronRight className="size-4" /></button>
              </span>
            )}
          </div>
        )}
        <div ref={frameRef} className="min-h-[320px] min-w-0 overflow-x-auto rounded-[10px] border border-border bg-[#F3F1EC] p-3">
          {!doc ? <p className="p-4 text-[13px] text-muted-foreground">Este caso no tiene documentos.</p>
          : doc.kind === "pdf" ? (
            <Document key={doc.id} file={`/api/v1/contracts/documents/${doc.id}/file`} onLoadSuccess={(pdf) => void onPdfLoad(pdf as unknown as PdfDoc, doc.id)}
              loading={<p className="p-4 text-[13px] text-muted-foreground">Cargando documento…</p>}
              error={<p className="p-4 text-[13px] text-muted-foreground">No se pudo mostrar el documento.</p>}>
              <div className="relative mx-auto w-fit shadow-sm">
                <Page pageNumber={Math.min(page, numPages || page)} width={width - 24} renderAnnotationLayer={false} renderTextLayer={false} />
                {marks.map(({ f, at }, k) => {
                  const n = numberOf.get(f.id)!;
                  const on = f.id === active;
                  const color = TONE[toneOf(f)];
                  const y = at.box ? (at.box.y1 + at.box.y2) / 2 : 0.04 + k * 0.035;
                  return (
                    <span key={`${f.id}-${k}`}>
                      {on && at.box && <span aria-hidden className="pointer-events-none absolute rounded-sm" style={{ left: `${at.box.x1 * 100}%`, top: `${at.box.y1 * 100}%`, width: `${(at.box.x2 - at.box.x1) * 100}%`, height: `${(at.box.y2 - at.box.y1) * 100}%`, background: `${color}22`, outline: `1.5px solid ${color}` }} />}
                      <button type="button" onClick={() => select(f)} aria-label={`Hallazgo ${n}: ${f.ruleName}`} aria-pressed={on}
                        className="absolute flex size-[20px] items-center justify-center rounded-full text-[11px] font-bold text-white shadow-sm ring-2 ring-white transition-transform hover:scale-110"
                        style={{ left: `${Math.max((at.box?.x1 ?? 0.04) * 100, 4)}%`, marginLeft: -26, top: `calc(${y * 100}% - 10px)`, backgroundColor: color, transform: on ? "scale(1.15)" : undefined }}>
                        {n}
                      </button>
                    </span>
                  );
                })}
              </div>
            </Document>
          ) : doc.kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/v1/contracts/documents/${doc.id}/file`} alt={doc.name} className="mx-auto max-w-full shadow-sm" />
          ) : <p className="p-4 text-[13px] text-muted-foreground">La vista previa no está disponible para este tipo de archivo.</p>}
        </div>
      </div>

      <aside aria-label="Hallazgos" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-[15px] font-semibold">{findings.length ? `${findings.length} hallazgo${findings.length === 1 ? "" : "s"}` : "Sin hallazgos"}</h3>
          {passed.length > 0 && (
            <button type="button" onClick={() => setShowPassed((v) => !v)} className="text-[12.5px] text-link hover:underline">
              {passed.length} validaci{passed.length === 1 ? "ón correcta" : "ones correctas"} · {showPassed ? "ocultar" : "ver"}
            </button>
          )}
        </div>
        {showPassed && (
          <ul className="flex flex-col gap-1 rounded-[10px] border border-border bg-card px-3.5 py-2.5 text-[12.5px]">
            {passed.map((p) => (
              <li key={p.id} className="flex items-start gap-2"><CheckCircle2 aria-hidden className="mt-0.5 size-3.5 shrink-0 text-tone-ok" /><span><b className="font-medium">{p.ruleName}</b> · {p.subject}</span></li>
            ))}
          </ul>
        )}
        <ol className="flex flex-col gap-2">
          {findings.map((f) => {
            const n = numberOf.get(f.id)!;
            const on = f.id === active;
            const color = TONE[toneOf(f)];
            const spots = f.evidence.map((e, i) => ({ e, at: whereIs(f, i) }));
            const firstAt = spots.find((s) => s.at)?.at;
            const where = firstAt ? `${nameOf.get(firstAt.docId) ?? "Documento"} p. ${firstAt.page}` : null;
            return (
              <li key={f.id} className={`rounded-[10px] border bg-card ${on ? "border-foreground/30 shadow-sm" : "border-border"}`}>
                <button type="button" onClick={() => select(f)} aria-expanded={on} className="flex w-full items-start gap-2.5 px-3.5 py-3 text-left">
                  <span className="mt-px flex size-[20px] shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ backgroundColor: color }}>{n}</span>
                  <span className="min-w-0 flex-1">
                    <b className="block text-[13.5px] font-semibold leading-snug">{f.ruleName}</b>
                    {!on && <span className="block truncate text-[12.5px] text-muted-foreground">{f.subject !== "—" ? `${f.subject} · ` : ""}{f.reason}</span>}
                    {!on && (where || f.ai) && <span className="block text-xs text-muted-foreground">{[where, f.ai ? "IA" : null].filter(Boolean).join(" · ")}</span>}
                  </span>
                </button>
                {on && (
                  <div className="flex flex-col gap-2.5 px-3.5 pb-3.5 pl-[42px] text-[13px]">
                    <p>{f.subject !== "—" && <b className="font-medium">{f.subject}: </b>}{f.reason}</p>
                    <p className="flex items-center gap-1.5 text-xs font-semibold" style={{ color }}>
                      {f.ok === null && <MinusCircle aria-hidden className="size-3.5" />}{severityText(f)}{f.ai ? " · análisis con IA" : ""}
                    </p>
                    {spots.map(({ e, at }, i) => (
                      <figure key={i} className="rounded-md border border-line-soft bg-background px-3 py-2">
                        <figcaption className="text-xs text-muted-foreground">
                          {at ? `${nameOf.get(at.docId) ?? "El documento"} dice · p. ${at.page}` : e.documentId && nameOf.get(e.documentId) ? `${nameOf.get(e.documentId)} dice` : "Cita"}
                        </figcaption>
                        <blockquote className="mt-0.5 text-[12.5px] italic leading-relaxed">«{e.quote}»</blockquote>
                        {at && (at.docId !== docId || at.page !== page) && (
                          <button type="button" onClick={() => goTo(at.docId, at.page)} className="mt-1 text-xs font-semibold text-link hover:underline">Abrir en esa página</button>
                        )}
                      </figure>
                    ))}
                    {f.evidence.length === 0 && <p className="text-xs text-muted-foreground">Este hallazgo no tiene una cita del documento.</p>}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </aside>
    </div>
  );
}
