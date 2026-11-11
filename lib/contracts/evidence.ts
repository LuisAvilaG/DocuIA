// Evidencia de una validación: qué texto del documento la respalda, en qué
// documento y página, y (en el visor) dónde está en la página. Sin dependencias
// de servidor: lo usan el pipeline y el visor del caso.

export interface EvidenceRef {
  documentId: string | null;
  docType: string | null;
  field: string | null;
  quote: string;
  page: number | null;
  /** Posición en la página (0–1), cuando se calculó en el servidor (páginas escaneadas). */
  box?: Box | null;
}

export interface Box { x1: number; y1: number; x2: number; y2: number }
export interface WordBox extends Box { text: string }

const MAX_PER_FINDING = 3;

/** Palabras comparables: minúsculas, sin tildes ni signos. */
export function quoteWords(value: string): string[] {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .split(/[^a-z0-9ñ]+/).filter((w) => w.length > 0);
}

function closeEnough(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1) return false;
  // Una letra distinta (OCR): misma longitud con un cambio, o una letra de más.
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** Página donde aparece la cita (la de más palabras en orden), o null si no se encuentra bien. */
export function findQuotePage(pages: Array<{ pageNumber: number; text: string }>, quote: string): number | null {
  const q = quoteWords(quote);
  if (q.length < 2) return null;
  let best: { page: number; score: number } | null = null;
  for (const page of pages) {
    const words = quoteWords(page.text);
    const score = bestWindow(words, q).score;
    if (score > (best?.score ?? 0)) best = { page: page.pageNumber, score };
  }
  return best && best.score >= Math.min(0.7, (q.length - 1) / q.length) ? best.page : null;
}

/** Mejor ventana de palabras para la cita: fracción de palabras de la cita que coinciden en orden. */
function bestWindow(words: string[], q: string[]): { start: number; end: number; score: number; hits: number[] } {
  let best = { start: -1, end: -1, score: 0, hits: [] as number[] };
  const first = new Set(q.slice(0, 3));
  for (let i = 0; i < words.length; i++) {
    if (![...first].some((f) => closeEnough(words[i], f))) continue;
    // Alinear en orden permitiendo palabras sueltas de más en el documento.
    let qi = q.findIndex((f) => closeEnough(words[i], f));
    const hits = [i];
    let wi = i + 1;
    qi++;
    const limit = Math.min(words.length, i + q.length * 2 + 2);
    while (qi < q.length && wi < limit) {
      if (closeEnough(words[wi], q[qi])) { hits.push(wi); qi++; wi++; continue; }
      if (qi + 1 < q.length && closeEnough(words[wi], q[qi + 1])) { hits.push(wi); qi += 2; wi++; continue; }
      wi++;
    }
    const score = hits.length / q.length;
    if (score > best.score) best = { start: i, end: hits[hits.length - 1], score, hits };
    if (score === 1) break;
  }
  return best;
}

/**
 * Recuadro de la cita en una página a partir de sus palabras con posición
 * (coordenadas 0–1). Se parte cada palabra del documento en palabras
 * comparables para que «S.A.S.,» o «1%» coincidan.
 */
export function matchQuote(words: WordBox[], quote: string): Box | null {
  const q = quoteWords(quote);
  if (q.length === 0) return null;
  const flat: Array<{ w: string; box: WordBox }> = [];
  for (const box of words) for (const w of quoteWords(box.text)) flat.push({ w, box });
  const found = bestWindow(flat.map((f) => f.w), q);
  const needed = q.length <= 2 ? 1 : 0.6;
  if (found.score < needed) return null;
  const boxes = found.hits.map((i) => flat[i].box);
  return {
    x1: Math.min(...boxes.map((b) => b.x1)), y1: Math.min(...boxes.map((b) => b.y1)),
    x2: Math.max(...boxes.map((b) => b.x2)), y2: Math.max(...boxes.map((b) => b.y2)),
  };
}

type Ref = { docType: string; field: string };
interface DocLike { documentId?: string; values: Record<string, unknown>; citations: Record<string, unknown> }

function refsOf(rule: Record<string, unknown>): Ref[] {
  const out: Ref[] = [];
  const add = (r: unknown) => {
    const o = r as { docType?: unknown; field?: unknown } | null;
    if (o && typeof o.docType === "string" && typeof o.field === "string") out.push({ docType: o.docType, field: o.field });
  };
  for (const key of ["subjects", "membership", "confirmation", "left", "right", "before", "signatures"]) add(rule[key]);
  add(rule);
  return out;
}

const text = (v: unknown) => (v === null || v === undefined ? "" : String(v)).trim();

/**
 * Citas de los campos que usa una regla. En listas (p. ej. firmantes) se toma
 * la cita del elemento que coincide con el sujeto del hallazgo.
 */
export function evidenceForFinding(rule: unknown, subject: string, docsByType: Record<string, DocLike[]>): EvidenceRef[] {
  if (!rule || typeof rule !== "object") return [];
  const subjectWords = quoteWords(subject);
  const out: EvidenceRef[] = [];
  for (const ref of refsOf(rule as Record<string, unknown>)) {
    for (const doc of (docsByType[ref.docType] ?? []).slice(0, 2)) {
      const cite = doc.citations[ref.field];
      const value = doc.values[ref.field];
      let quote = "";
      if (Array.isArray(cite)) {
        const values = Array.isArray(value) ? value : [];
        const k = values.findIndex((v) => {
          const vw = quoteWords(typeof v === "object" && v !== null ? Object.values(v).join(" ") : text(v));
          return subjectWords.length > 0 && subjectWords.every((w) => vw.includes(w));
        });
        if (k >= 0) quote = text(cite[k]);
      } else quote = text(cite);
      if (quote && !out.some((e) => e.quote === quote)) {
        out.push({ documentId: doc.documentId ?? null, docType: ref.docType, field: ref.field, quote: quote.slice(0, 400), page: null });
      }
      if (out.length >= MAX_PER_FINDING) return out;
    }
  }
  return out;
}

/** Evidencia a partir de citas sueltas (análisis con IA, referencias del Archivo). */
export function evidenceFromQuotes(quotes: Array<string | null | undefined>, page: number | null = null): EvidenceRef[] {
  const seen = new Set<string>();
  const out: EvidenceRef[] = [];
  for (const q of quotes) {
    const quote = text(q).slice(0, 400);
    if (!quote || seen.has(quote)) continue;
    seen.add(quote);
    out.push({ documentId: null, docType: null, field: null, quote, page });
    if (out.length >= MAX_PER_FINDING) break;
  }
  return out;
}
