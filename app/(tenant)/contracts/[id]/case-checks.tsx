"use client";

// Validaciones sobre el documento, a todo el ancho: el documento a la izquierda
// y los hallazgos a la derecha, cada mitad con su propio desplazamiento. El
// análisis con IA va dentro de su hallazgo: una tabla con lo que encontró, y la
// cita de la fila elegida se ve una sola vez y se resalta en la página.
import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { ChevronLeft, ChevronRight, CheckCircle2, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusPill } from "@/components/kit";
import { matchQuote, type Box, type EvidenceRef, type WordBox } from "@/lib/contracts/evidence";
import { pageWords, type PdfTextDoc } from "@/lib/contracts/pdf-words";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

export interface CheckDoc { id: string; name: string; kind: "pdf" | "image" | "other" }
export interface CheckFinding {
  id: number; ruleName: string; severity: "info" | "warn" | "block"; subject: string; status: string;
  ok: boolean | null; reason: string; ai: boolean; evidence: EvidenceRef[];
}
export interface CheckPassed { id: number; ruleName: string; subject: string; status: string }
/** An informative rule that did not pass (or could not be verified): shown, never counted. */
export interface CheckNote { id: number; ruleName: string; subject: string; reason: string; verified: boolean }
/** The full answer of an «Análisis con IA» control: one row per thing it found. */
export interface CheckAnalysis {
  id: string; ruleName: string; passed: boolean; summary: string | null;
  columns: string[]; rows: Array<{ values: Record<string, string>; evidence: string | null }>; citations: string[];
}

type Located = { docId: string; page: number; box: Box | null };
type PdfDoc = PdfTextDoc;
/** A quote that can be shown on the page: a citation of a finding or the evidence of a table row. */
type Spot = { key: string; card: string; quote: string; documentId: string | null; page: number | null; box: Box | null };
type Card = {
  key: string; n: number | null; finding: CheckFinding | null; analysis: CheckAnalysis | null;
  rows: Array<{ values: Record<string, string>; spot: Spot | null }>;
  /** Citations that belong to no row of the table. */
  quotes: Spot[];
};

const MAX_SCAN_PAGES = 80;
const MAX_PAGE_WIDTH = 860;
const TONE = { block: "#B3261E", warn: "#B07C0E", unknown: "#6B6560", ok: "#1F6B4A" } as const;
const toneOf = (f: CheckFinding | null) => (!f ? "ok" : f.ok === false && f.severity === "block" ? "block" : f.ok === false || f.severity === "block" ? "warn" : "unknown");
const severityText = (f: CheckFinding) => f.ok === false && f.severity === "block" ? "Bloquea la aprobación" : f.ok === false ? "A revisar" : "No se pudo verificar";
const sameQuote = (q: string) => q.trim().slice(0, 400);
const columnLabel = (key: string) => key.replace(/[_.]/g, " ").trim();

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

/** Hallazgos primero (numerados); después, los análisis con IA que no dejaron hallazgo. */
function buildCards(findings: CheckFinding[], analyses: CheckAnalysis[]): Card[] {
  const used = new Set<string>();
  const make = (key: string, n: number | null, finding: CheckFinding | null, analysis: CheckAnalysis | null): Card => {
    const evidence = finding?.evidence ?? [];
    const stored = new Map(evidence.map((e) => [sameQuote(e.quote), e]));
    const inRows = new Set<string>();
    const rows = (analysis?.rows ?? []).map((row, i) => {
      if (!row.evidence) return { values: row.values, spot: null };
      const quote = sameQuote(row.evidence);
      inRows.add(quote);
      const known = stored.get(quote);
      return { values: row.values, spot: { key: `${key}:r${i}`, card: key, quote: row.evidence, documentId: known?.documentId ?? null, page: known?.page ?? null, box: known?.box ?? null } };
    });
    const quotes: Spot[] = evidence.filter((e) => !inRows.has(sameQuote(e.quote)))
      .map((e, i) => ({ key: `${key}:e${i}`, card: key, quote: e.quote, documentId: e.documentId, page: e.page, box: e.box ?? null }));
    const seen = new Set([...inRows, ...quotes.map((q) => sameQuote(q.quote))]);
    for (const [i, citation] of (analysis?.citations ?? []).entries()) {
      if (quotes.length >= 4 || seen.has(sameQuote(citation))) continue;
      seen.add(sameQuote(citation));
      quotes.push({ key: `${key}:c${i}`, card: key, quote: citation, documentId: null, page: null, box: null });
    }
    return { key, n, finding, analysis, rows, quotes };
  };
  const cards = findings.map((f, i) => {
    const analysis = f.ai ? analyses.find((a) => a.ruleName === f.ruleName && !used.has(a.id)) ?? null : null;
    if (analysis) used.add(analysis.id);
    return make(`f${f.id}`, i + 1, f, analysis);
  });
  return [...cards, ...analyses.filter((a) => !used.has(a.id)).map((a) => make(`a${a.id}`, null, null, a))];
}

const spotsOf = (card: Card): Spot[] => [...card.rows.flatMap((row) => (row.spot ? [row.spot] : [])), ...card.quotes];

export function CaseChecks({ docs, findings, passed, notes = [], analyses = [], verdict }: {
  docs: CheckDoc[]; findings: CheckFinding[]; passed: CheckPassed[]; notes?: CheckNote[]; analyses?: CheckAnalysis[];
  /** «Con advertencias», «Con bloqueos»… beside the count of findings. */
  verdict?: string;
}) {
  const cards = useMemo(() => buildCards(findings, analyses), [findings, analyses]);
  const spots = useMemo(() => cards.flatMap(spotsOf), [cards]);
  const findingCards = cards.filter((card) => card.finding);
  const cleanCards = cards.filter((card) => !card.finding);

  // The screen opens on the first finding, with its first row (or citation) chosen.
  const [active, setActive] = useState<string | null>(cards[0]?.finding ? cards[0].key : null);
  const [chosen, setChosen] = useState<string | null>(() => (cards[0]?.finding ? spotsOf(cards[0])[0]?.key ?? null : null));
  // Document and page come from one same citation: the chosen one, or the first
  // that names a document. (Taken apart, the page could be another document's.)
  const [start] = useState(() => {
    const first = cards[0]?.finding ? spotsOf(cards[0]) : [];
    return [...first, ...spots].find((s) => s.documentId && s.page) ?? [...first, ...spots].find((s) => s.documentId) ?? null;
  });
  const [docId, setDocId] = useState<string | null>(start?.documentId ?? docs[0]?.id ?? null);
  const [page, setPage] = useState(start?.page ?? 1);
  const [numPages, setNumPages] = useState(0);
  const [located, setLocated] = useState<Record<string, Located>>({});
  const [showPassed, setShowPassed] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [frameRef, width] = useWidth<HTMLDivElement>();
  const scanned = useRef(new Set<string>());
  // Until the reader moves, the document follows the chosen citation once it is found.
  const moved = useRef(false);
  const chosenRef = useRef(chosen);
  useEffect(() => { chosenRef.current = chosen; }, [chosen]);
  // The chosen citation is brought into view: it may be further down the page than the viewer shows.
  const chosenMark = useRef<HTMLButtonElement>(null);
  useEffect(() => { chosenMark.current?.scrollIntoView({ block: "nearest" }); }, [chosen, page, docId, located]);

  const doc = docs.find((d) => d.id === docId) ?? null;
  const nameOf = useMemo(() => new Map(docs.map((d) => [d.id, d.name])), [docs]);

  // Ubicación de cada cita: la calculada en el visor, o la página guardada.
  const whereIs = useCallback((s: Spot): Located | null => {
    const found = located[s.key];
    if (found) return found;
    return s.documentId && s.page ? { docId: s.documentId, page: s.page, box: s.box } : null;
  }, [located]);

  const onPdfLoad = useCallback(async (pdf: PdfDoc, forDoc: string) => {
    setNumPages(pdf.numPages);
    if (scanned.current.has(forDoc)) return;
    scanned.current.add(forDoc);
    const cache = new Map<number, WordBox[]>();
    const words = async (n: number) => { if (!cache.has(n)) cache.set(n, await pageWords(pdf, n).catch(() => [])); return cache.get(n)!; };
    const found: Record<string, Located> = {};
    for (const s of spots) {
      if (s.documentId && s.documentId !== forDoc) continue;
      if (s.box && s.page) continue;
      const pages = s.page && s.documentId === forDoc ? [s.page] : Array.from({ length: Math.min(pdf.numPages, MAX_SCAN_PAGES) }, (_, k) => k + 1);
      for (const n of pages) {
        const box = matchQuote(await words(n), s.quote);
        if (box) { found[s.key] = { docId: forDoc, page: n, box }; break; }
      }
    }
    // A citation found in the first document it was looked for stays there.
    setLocated((prev) => ({ ...found, ...prev }));
    const first = chosenRef.current ? found[chosenRef.current] : undefined;
    if (!moved.current && first) setPage(first.page);
  }, [spots]);

  function goTo(id: string, n: number) {
    moved.current = true;
    if (id !== docId) setNumPages(0);
    setDocId(id); setPage(n);
  }

  function choose(card: Card, spot: Spot | null) {
    setActive(card.key);
    const target = spot ?? spotsOf(card)[0] ?? null;
    setChosen(target?.key ?? null);
    const at = target ? whereIs(target) : null;
    if (at) goTo(at.docId, at.page);
  }

  // Marcadores de la página visible: los de los hallazgos y los de la tarjeta abierta.
  const cardOf = new Map(cards.map((card) => [card.key, card]));
  const marks = spots.map((s) => ({ s, at: whereIs(s), card: cardOf.get(s.card)! }))
    .filter((m): m is { s: Spot; at: Located; card: Card } => !!m.at && m.at.docId === docId && m.at.page === page && (m.card.finding !== null || m.card.key === active));
  const markers = marks.map(({ s, at, card }, k) => {
    const on = chosen ? s.key === chosen : card.key === active;
    const color = TONE[toneOf(card.finding)];
    const y = at.box ? (at.box.y1 + at.box.y2) / 2 : 0.04 + k * 0.035;
    return (
      <span key={s.key}>
        {on && at.box && <span aria-hidden className="pointer-events-none absolute rounded-sm" style={{ left: `${at.box.x1 * 100}%`, top: `${at.box.y1 * 100}%`, width: `${(at.box.x2 - at.box.x1) * 100}%`, height: `${(at.box.y2 - at.box.y1) * 100}%`, background: `${color}22`, outline: `1.5px solid ${color}` }} />}
        <button type="button" ref={s.key === chosen ? chosenMark : undefined} onClick={() => choose(card, s)} aria-label={`${card.n ? `Hallazgo ${card.n}` : "Sin observaciones"}: ${(card.finding ?? card.analysis)!.ruleName}`} aria-pressed={on}
          className="absolute flex size-[20px] scroll-my-16 items-center justify-center rounded-full text-[11px] font-bold text-white shadow-sm ring-2 ring-white transition-transform hover:scale-110"
          style={{ left: `${Math.max((at.box?.x1 ?? 0.04) * 100, 4)}%`, marginLeft: -26, top: `calc(${y * 100}% - 10px)`, backgroundColor: color, transform: on ? "scale(1.15)" : undefined }}>
          {card.n ?? "✓"}
        </button>
      </span>
    );
  });

  // Los análisis sin hallazgo se ven como tarjeta; aquí van los demás controles correctos.
  const cleanNames = new Set(cleanCards.map((card) => card.analysis!.ruleName));
  const plainPassed = passed.filter((p) => !(p.subject === "Análisis con IA" && cleanNames.has(p.ruleName)));
  const passedCards = cleanCards.filter((card) => card.analysis!.passed);
  const infoCards = cleanCards.filter((card) => !card.analysis!.passed);
  const plainNotes = notes.filter((n) => !(n.subject === "Análisis con IA" && cleanNames.has(n.ruleName)));
  const cleanCount = plainPassed.length + passedCards.length;
  const noteCount = plainNotes.length + infoCards.length;
  const hasRows = cards.some((card) => card.rows.length > 0);

  const renderCard = (card: Card) => {
    const f = card.finding;
    const title = (f ?? card.analysis)!.ruleName;
    const on = card.key === active;
    const color = TONE[toneOf(f)];
    const text = f ? f.reason : card.analysis!.summary ?? "";
    const lead = /^([\s\S]+?[.!?])\s+([\s\S]+)$/.exec(text.trim());
    const columns = card.analysis?.columns ?? [];
    return (
      <li key={card.key}>
        <article aria-labelledby={`h-${card.key}`} className={cn("flex flex-col gap-3 rounded-xl border bg-card px-4.5 py-4", on ? "border-foreground/30" : "border-border")}>
          <button type="button" onClick={() => (on ? setActive(null) : choose(card, null))} aria-expanded={on} className="flex w-full items-start gap-2.5 text-left">
            <span aria-hidden className="mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ backgroundColor: color }}>{card.n ?? "✓"}</span>
            <span className="min-w-0 flex-1">
              <b id={`h-${card.key}`} className="block text-[14.5px] font-semibold leading-snug">{title}</b>
              <span className={cn("block text-[12.5px] text-muted-foreground", !on && "truncate")}>
                {on ? (f?.ai || !f ? "Análisis con IA" : f.subject !== "—" ? f.subject : "Control del flujo") : [f && !f.ai && f.subject !== "—" ? f.subject : null, text].filter(Boolean).join(" · ")}
              </span>
            </span>
            <StatusPill tone={!f ? (card.analysis!.passed ? "ok" : "mute") : toneOf(f) === "block" ? "err" : "warn"}>{f ? severityText(f) : card.analysis!.passed ? "Sin observaciones" : "Informativo"}</StatusPill>
          </button>

          {on && (
            <>
              {text && (
                <p className="whitespace-pre-line text-sm">
                  {lead ? <><b className="font-semibold">{lead[1]}</b> {lead[2]}</> : <b className="font-semibold">{text}</b>}
                </p>
              )}

              {card.rows.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-[13.5px]">
                    <thead>
                      <tr>
                        {columns.map((key) => <th key={key} scope="col" className="whitespace-nowrap border-b border-border px-2.5 py-2 text-left text-[11.5px] font-semibold uppercase tracking-[0.05em] text-foreground/75">{columnLabel(key)}</th>)}
                        <th scope="col" className="whitespace-nowrap border-b border-border px-2.5 py-2 text-left text-[11.5px] font-semibold uppercase tracking-[0.05em] text-foreground/75">Dónde</th>
                      </tr>
                    </thead>
                    <tbody>
                      {card.rows.map((row, i) => {
                        const selected = row.spot !== null && row.spot.key === chosen;
                        const at = row.spot ? whereIs(row.spot) : null;
                        return (
                          <tr key={i} onClick={() => row.spot && choose(card, row.spot)} aria-selected={selected}
                            className={cn("border-b border-line-soft last:border-0 [&>td]:p-2.5 [&>td]:align-top", row.spot && "cursor-pointer", selected ? "bg-[#FFFBF2]" : row.spot && "hover:bg-secondary/40")}>
                            {columns.map((key, c) => {
                              const value = row.values[key]?.trim();
                              return (
                                <td key={key} className={cn(c > 0 && !value && "font-semibold text-tone-warn", c > 0 && (value?.length ?? 0) <= 18 && "whitespace-nowrap")}>
                                  {c === 0 && row.spot
                                    ? <button type="button" onClick={(e) => { e.stopPropagation(); choose(card, row.spot); }} className={cn("text-left", selected && "font-semibold")}>{value || "—"}</button>
                                    : value || (c === 0 ? "—" : "Pendiente")}
                                  {c === 0 && selected && <small className="mt-1 block text-[13px] italic leading-relaxed text-foreground/75">«{row.spot!.quote}»</small>}
                                </td>
                              );
                            })}
                            <td className="whitespace-nowrap">
                              {at
                                ? <button type="button" onClick={(e) => { e.stopPropagation(); choose(card, row.spot); }} className="text-link hover:underline">{docs.length > 1 ? `${nameOf.get(at.docId) ?? "Documento"} · ` : ""}p. {at.page}</button>
                                : <span className="text-muted-foreground">{row.spot ? "Sin ubicar" : "—"}</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {card.quotes.map((s) => {
                const at = whereIs(s);
                const shown = s.key === chosen;
                return (
                  <figure key={s.key} className={cn("rounded-md border px-3 py-2", shown ? "border-[#EBD9AE] bg-[#FFFBF2]" : "border-line-soft bg-background")}>
                    <figcaption className="text-xs text-muted-foreground">
                      {at ? `${nameOf.get(at.docId) ?? "El documento"} dice · p. ${at.page}` : s.documentId && nameOf.get(s.documentId) ? `${nameOf.get(s.documentId)} dice` : "Cita"}
                    </figcaption>
                    <blockquote className="mt-0.5 text-[13px] italic leading-relaxed">«{s.quote}»</blockquote>
                    {at && !shown && <button type="button" onClick={() => choose(card, s)} className="mt-1 text-xs font-semibold text-link hover:underline">Ver en el documento</button>}
                  </figure>
                );
              })}
              {f && card.rows.length === 0 && card.quotes.length === 0 && <p className="text-xs text-muted-foreground">Este hallazgo no tiene una cita del documento.</p>}
            </>
          )}
        </article>
      </li>
    );
  };

  return (
    <div className="grid grid-cols-1 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col bg-[#E9E6E0] lg:min-h-0">
        <div className="flex flex-wrap items-center gap-2.5 border-b border-border bg-[#F4F2EE] px-4 py-2.5 text-[13px]">
          {docs.length > 1 ? (
            <div role="tablist" aria-label="Documentos del caso" className="flex min-w-0 flex-wrap gap-1.5">
              {docs.map((d) => (
                <button key={d.id} role="tab" aria-selected={d.id === docId} type="button" onClick={() => goTo(d.id, 1)}
                  className={cn("max-w-[220px] truncate rounded-md border px-2.5 py-1 text-[12.5px]", d.id === docId ? "border-primary bg-card font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
                  {d.name}
                </button>
              ))}
            </div>
          ) : <b className="min-w-0 truncate font-semibold">{doc?.name ?? "Sin documento"}</b>}
          {doc?.kind === "pdf" && numPages > 0 && (
            <>
              <span className="ml-auto tabular-nums text-muted-foreground">Página {Math.min(page, numPages)} de {numPages}</span>
              <button type="button" aria-label="Página anterior" disabled={page <= 1} onClick={() => { moved.current = true; setPage((p) => p - 1); }} className="flex size-[30px] items-center justify-center rounded-md border border-[#D6D2C8] bg-card disabled:opacity-40"><ChevronLeft className="size-4" /></button>
              <button type="button" aria-label="Página siguiente" disabled={page >= numPages} onClick={() => { moved.current = true; setPage((p) => p + 1); }} className="flex size-[30px] items-center justify-center rounded-md border border-[#D6D2C8] bg-card disabled:opacity-40"><ChevronRight className="size-4" /></button>
            </>
          )}
        </div>
        <div className="min-w-0 overflow-auto p-5.5 lg:min-h-0 lg:flex-1">
          <div ref={frameRef} className="min-w-0">
            {!doc ? <p className="text-[13px] text-muted-foreground">Este caso no tiene documentos.</p>
            : doc.kind === "pdf" ? (
              <Document key={doc.id} file={`/api/v1/contracts/documents/${doc.id}/file`} onLoadSuccess={(pdf) => void onPdfLoad(pdf as unknown as PdfDoc, doc.id)}
                loading={<p className="text-[13px] text-muted-foreground">Cargando documento…</p>}
                error={<p className="text-[13px] text-muted-foreground">No se pudo mostrar el documento.</p>}>
                <div className="relative mx-auto w-fit shadow-[0_2px_16px_rgba(30,32,41,0.14)]">
                  <Page pageNumber={Math.min(page, numPages || page)} width={Math.min(width, MAX_PAGE_WIDTH)} renderAnnotationLayer={false} renderTextLayer={false} />
                  {markers}
                </div>
              </Document>
            ) : doc.kind === "image" ? (
              <div className="relative mx-auto w-fit shadow-[0_2px_16px_rgba(30,32,41,0.14)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/v1/contracts/documents/${doc.id}/file`} alt={doc.name} className="block max-w-full" />
                {markers}
              </div>
            ) : <p className="text-[13px] text-muted-foreground">La vista previa no está disponible para este tipo de archivo.</p>}
          </div>
        </div>
      </div>

      <aside aria-label="Hallazgos" className="flex min-w-0 flex-col gap-3.5 px-6 pb-6 pt-5 md:px-6.5 lg:min-h-0 lg:overflow-y-auto">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 className="text-[15px] font-semibold">{findings.length ? `${findings.length} hallazgo${findings.length === 1 ? "" : "s"}` : "Sin hallazgos"}</h2>
          <span className="text-[12.5px] text-muted-foreground">{[verdict, hasRows ? "toca una fila para verla en el documento" : null].filter(Boolean).join(" · ")}</span>
        </div>
        {findingCards.length > 0 && <ol className="flex flex-col gap-3">{findingCards.map(renderCard)}</ol>}

        <div>
          <div className="flex items-center justify-between gap-3 border-t border-border py-2.5 text-[13.5px]">
            <span>Controles sin observaciones</span>
            {cleanCount > 0
              ? <button type="button" onClick={() => setShowPassed((v) => !v)} aria-expanded={showPassed} className="text-link hover:underline">{cleanCount} · {showPassed ? "ocultar" : "ver"}</button>
              : <span className="text-muted-foreground">Ninguno en este caso</span>}
          </div>
          {showPassed && (
            <div className="flex flex-col gap-3 pb-2.5">
              {plainPassed.length > 0 && (
                <ul className="flex flex-col gap-1 text-[13px]">
                  {plainPassed.map((p) => (
                    <li key={p.id} className="flex items-start gap-2"><CheckCircle2 aria-hidden className="mt-0.5 size-3.5 shrink-0 text-tone-ok" /><span><b className="font-medium">{p.ruleName}</b> · {p.subject}</span></li>
                  ))}
                </ul>
              )}
              {passedCards.length > 0 && <ul className="flex flex-col gap-3">{passedCards.map(renderCard)}</ul>}
            </div>
          )}
          {noteCount > 0 && (
            <>
              <div className="flex items-center justify-between gap-3 border-t border-border py-2.5 text-[13.5px]">
                <span>Notas informativas <span className="text-muted-foreground">· no frenan la aprobación</span></span>
                <button type="button" onClick={() => setShowNotes((v) => !v)} aria-expanded={showNotes} className="text-link hover:underline">{noteCount} · {showNotes ? "ocultar" : "ver"}</button>
              </div>
              {showNotes && (
                <div className="flex flex-col gap-3 pb-2.5">
                  <ul className="flex flex-col gap-1.5 text-[13px]">
                    {plainNotes.map((n) => (
                      <li key={n.id} className="flex items-start gap-2"><Info aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" /><span><b className="font-medium">{n.ruleName}</b>{n.subject !== "—" ? ` · ${n.subject}` : ""}{n.reason ? `: ${n.reason}` : ""}{n.verified ? "" : " (no se pudo verificar)"}</span></li>
                    ))}
                  </ul>
                  {infoCards.length > 0 && <ul className="flex flex-col gap-3">{infoCards.map(renderCard)}</ul>}
                </div>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
