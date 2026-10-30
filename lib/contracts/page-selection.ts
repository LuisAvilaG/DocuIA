// Page locator for long contracts: which pages to show the model for a given
// list of fields. Pure text and counting, no AI. Three signals, strongest first:
//   1. the document's own index (table of contents), mapped to PDF pages;
//   2. field hints: the words a clause usually carries (vigencia, póliza, NIT...),
//      weighted by rarity and matched with one-character tolerance so OCR noise
//      still hits; the clause heading as a phrase counts most;
//   3. fixed pages: cover and closing pages, where parties, dates and
//      signatures live whatever the contract.
// The result is explainable (a reason per page) and bounded (max pages).

import type { FieldDef } from "./extract";
import type { IndexedPageText } from "./reference-codes";

export interface LocatedPages {
  /** Pages to send, ascending. */
  pages: number[];
  /** Candidate pages per field, best first; the second pass widens from here. */
  byField: Record<string, number[]>;
  /** Why each selected page is there. */
  reasons: Record<number, string[]>;
}

export interface LocateOptions {
  /** Upper bound on pages returned, fixed pages included. */
  maxPages?: number;
  /** Cover pages always included. */
  fixedHead?: number;
  /** Closing pages always included. */
  fixedTail?: number;
}

// Words a field's clause tends to use, keyed by what the field is about. The
// field's own key and label words always count, with more weight.
const FIELD_HINTS: Array<{ match: RegExp; terms: string[] }> = [
  { match: /plazo|vigencia|duraci|termino|term\b|fecha de (fin|termin)|ejecuci/, terms: ["plazo", "vigencia", "duracion", "prorroga", "meses", "anos", "dias", "termino", "ejecucion", "inicia", "culmina", "vence"] },
  { match: /valor|monto|precio|importe|suma|honorario|cuantia|presupuesto|inversion/, terms: ["valor", "precio", "monto", "suma", "importe", "pesos", "dolares", "honorarios", "cuantia", "incluido", "iva", "millones", "total", "inversion"] },
  { match: /garant|poliza|amparo|fianza|seguro|caucion/, terms: ["garantia", "garantias", "poliza", "polizas", "amparo", "amparos", "fianza", "cumplimiento", "aseguradora", "caucion", "cobertura", "asegurar", "asegurado", "porcentaje", "vigencia", "renovar"] },
  { match: /objeto|alcance|descripcion|servicio/, terms: ["objeto", "alcance", "obliga", "prestacion", "servicios", "actividades", "conformidad"] },
  { match: /parte|contratante|contratista|tomador|concesionario|concedente|proveedor|cliente|arrendador|arrendatario|comprador|vendedor|representante|razon social|empresa|sociedad|nombre/, terms: ["contratante", "contratista", "tomador", "concesionario", "concedente", "sociedad", "representante", "representacion", "identificado", "identificada", "suscritos", "celebran", "denominara", "constituida", "domicilio", "matricula"] },
  { match: /nit|rut|ruc|rfc|cuit|identificaci|cedula|documento de identidad/, terms: ["nit", "rut", "ruc", "rfc", "identificacion", "identificado", "identificada", "cedula", "ciudadania", "expedida", "matricula"] },
  { match: /fecha|suscri|firma|celebra|otorga/, terms: ["fecha", "suscrito", "suscribe", "suscripcion", "firmado", "firma", "firman", "celebrado", "celebra", "otorgado", "ciudad", "constancia", "ejemplares", "cierre"] },
  { match: /numero|n[uú]m|codigo|referencia|contrato no|no\.? contrato|folio/, terms: ["contrato", "numero", "codigo", "referencia", "folio", "expediente"] },
  { match: /arbitr|controversia|conflicto|jurisdic|litig|ley aplicable|tribunal/, terms: ["arbitraje", "arbitral", "arbitro", "arbitros", "controversias", "controversia", "tribunal", "ciadi", "uncitral", "cnudmi", "camara", "comercio", "laudo", "jurisdiccion", "conciliacion", "sede"] },
  { match: /pago|factur|anticipo|cuota|desembolso|forma de pago/, terms: ["pago", "pagos", "pagara", "factura", "facturacion", "anticipo", "cuotas", "mensual", "vencido", "desembolso", "abono"] },
  { match: /multa|penal|sancion|incumplim/, terms: ["multa", "multas", "penalidad", "penalidades", "penal", "sancion", "sanciones", "incumplimiento", "mora", "retraso"] },
  { match: /terminac|resoluc|caducid|rescis|resciliac/, terms: ["terminacion", "terminar", "resolucion", "resolver", "caducidad", "rescision", "resciliacion", "causales", "anticipada"] },
  { match: /capital|accion|socio|participaci/, terms: ["capital", "social", "acciones", "accionaria", "socio", "socios", "participacion", "suscrito", "pagado"] },
  { match: /entrega|lugar|sitio|ubicaci|direccion|domicilio/, terms: ["entrega", "lugar", "ubicado", "ubicada", "direccion", "domicilio", "ciudad", "localidad"] },
  { match: /obligaci|responsabil|deber/, terms: ["obligaciones", "obligacion", "obliga", "responsabilidad", "responsable", "deberes", "debera"] },
  { match: /confidencial|propiedad intelectual|datos/, terms: ["confidencialidad", "confidencial", "reserva", "propiedad", "intelectual", "datos", "personales", "informacion"] },
];

function flatten(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function normalizeWords(value: string): string[] {
  return flatten(value).split(/[^a-z0-9]+/).filter((word) => word.length >= 3);
}

// Function words dropped before phrase comparison, so "garantía de fiel
// cumplimiento del contrato" and the field label "Garantía fiel cumplimiento
// contrato" meet on the same string.
const STOP_WORDS = new Set(["de", "del", "la", "el", "los", "las", "y", "e", "o", "u", "en", "a", "al", "por", "para", "con", "sin", "su", "sus", "se", "que", "un", "una", "uno", "lo", "le", "les", "no", "the", "of", "and"]);

function contentWords(value: string): string[] {
  return flatten(value).split(/[^a-z0-9]+/).filter((word) => word.length >= 2 && !STOP_WORDS.has(word));
}

/** True when the strings are equal or one character apart (typo, OCR confusion, missing letter). */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (la > lb) i++; else if (lb > la) j++; else { i++; j++; }
  }
  return edits + (la - i) + (lb - j) <= 1;
}

interface PageIndex {
  pageNumber: number;
  /** Accent-free lowercase text with single spaces, for phrase matches. */
  flat: string;
  tokens: Set<string>;
  /** Tokens of 6+ characters bucketed by first letter, for the tolerant match. */
  buckets: Map<string, string[]>;
}

function indexPage(page: IndexedPageText): PageIndex {
  const tokens = new Set(normalizeWords(page.text));
  const buckets = new Map<string, string[]>();
  for (const token of tokens) {
    if (token.length < 6) continue;
    (buckets.get(token[0]) ?? buckets.set(token[0], []).get(token[0])!).push(token);
  }
  const flat = ` ${contentWords(page.text).join(" ")} `;
  return { pageNumber: page.pageNumber, flat, tokens, buckets };
}

function pageHas(page: PageIndex, term: string): boolean {
  if (page.tokens.has(term)) return true;
  if (term.length < 6) return false;
  const bucket = page.buckets.get(term[0]);
  return bucket ? bucket.some((token) => withinOneEdit(token, term)) : false;
}

// Words that cluster on signature blocks and notification clauses.
const SIGNATURE_MARKERS = ["firma", "firmas", "firmado", "firman", "firmante", "suscriben", "suscrito", "conformidad", "constancia", "notificacion", "notificaciones", "direccion", "atencion", "nombre", "representante", "apoderado", "ejemplares", "ciudad"];

function signaturePages(index: PageIndex[], count: number): number[] {
  return index
    .map((page) => ({ page: page.pageNumber, hits: SIGNATURE_MARKERS.filter((marker) => page.tokens.has(marker)).length }))
    .filter((entry) => entry.hits >= 4)
    .sort((a, b) => b.hits - a.hits || b.page - a.page)
    .slice(0, count)
    .map((entry) => entry.page);
}

interface FieldTerms { fieldKey: string; own: string[]; hints: string[] }

function termsFor(field: FieldDef): FieldTerms {
  const text = `${field.fieldKey} ${field.label}`;
  const probe = flatten(text);
  const own = [...new Set(normalizeWords(field.label).filter((word) => word.length >= 4))];
  const keyWords = normalizeWords(field.fieldKey.replace(/_/g, " ")).filter((word) => word.length >= 4 && !own.includes(word));
  own.push(...keyWords);
  const hints = new Set<string>();
  for (const hint of FIELD_HINTS) if (hint.match.test(probe)) for (const term of hint.terms) if (!own.includes(term)) hints.add(term);
  return { fieldKey: field.fieldKey, own, hints: [...hints] };
}

// ── Index (table of contents) ─────────────────────────────────────────
// OCR often breaks an entry over two lines ("Plazo de la Concesión" / "..... 44"),
// so a dots-and-number line is attached to the title line before it.
const TOC_LINE = /^\s*(.{4,140}?)[\s.·_\-,]{3,}\s*(\d{1,4})\s*$/;
const TOC_TAIL = /^[\s.·_\-,¿]*(\d{1,4})\s*$/;
const LINE_BREAK = /\r?\n/;

export interface TocEntry { title: string; docPage: number }

export function parseToc(pages: IndexedPageText[]): TocEntry[] {
  const entries: TocEntry[] = [];
  for (const page of pages.slice(0, 8)) {
    const found: TocEntry[] = [];
    let previous = "";
    for (const rawLine of page.text.split(LINE_BREAK)) {
      const line = rawLine.trim();
      if (!line) continue;
      // A dots-and-number line has no letters, so test it first: otherwise
      // ".. . . ..44" passes as a whole entry with an empty title.
      const tail = line.match(TOC_TAIL);
      const whole = tail ? null : line.match(TOC_LINE);
      const title = whole ? whole[1] : tail && previous ? previous : null;
      const docPage = Number(whole ? whole[2] : tail?.[1]);
      if (title && docPage >= 1 && docPage <= 5000 && normalizeWords(title).length > 0) found.push({ title, docPage });
      previous = whole || tail ? "" : line;
    }
    // A real index page lists many entries; a stray "Cláusula 3 ..... 12" is not one.
    if (found.length >= 5) entries.push(...found);
  }
  return entries;
}

/** PDF page minus the number printed on it, taken as the most common value over a sample. */
export function printedPageOffset(pages: IndexedPageText[]): number {
  const votes = new Map<number, number>();
  for (const page of pages.slice(5, 80)) {
    for (const line of page.text.split(LINE_BREAK)) {
      const m = line.trim().match(/^\[?(\d{1,4})\]?(?:\s*\[\d{1,4}\])?$/);
      if (!m) continue;
      const printed = Number(m[1]);
      const offset = page.pageNumber - printed;
      if (Math.abs(offset) <= 6) votes.set(offset, (votes.get(offset) ?? 0) + 1);
    }
  }
  let best = 0, bestVotes = 0;
  for (const [offset, count] of votes) if (count > bestVotes) { best = offset; bestVotes = count; }
  return bestVotes >= 3 ? best : 0;
}

// ── Locator ───────────────────────────────────────────────────────────
export function locatePages(pages: IndexedPageText[], fields: FieldDef[], options: LocateOptions = {}): LocatedPages {
  const maxPages = options.maxPages ?? 12;
  const fixedHead = options.fixedHead ?? 2;
  const fixedTail = options.fixedTail ?? 2;
  const nonEmpty = pages.filter((page) => page.text.trim().length >= 40);
  if (nonEmpty.length === 0) return { pages: [], byField: {}, reasons: {} };

  const reasons: Record<number, string[]> = {};
  const add = (page: number, reason: string) => { (reasons[page] ??= []).push(reason); };
  const selected = new Set<number>();
  for (const page of nonEmpty.slice(0, fixedHead)) { selected.add(page.pageNumber); add(page.pageNumber, "portada"); }
  for (const page of nonEmpty.slice(-fixedTail)) if (!selected.has(page.pageNumber)) { selected.add(page.pageNumber); add(page.pageNumber, "cierre"); }

  const index = nonEmpty.map(indexPage);
  // Signature and notification pages carry the parties' real names, addresses
  // and signatories, which no field label can name in advance.
  for (const page of signaturePages(index, 2)) if (!selected.has(page)) { selected.add(page); add(page, "firmas"); }
  const byNumber = new Map(index.map((page) => [page.pageNumber, page]));
  const toc = parseToc(pages);
  const offset = toc.length ? printedPageOffset(pages) : 0;

  // Words on most pages (the contract's own name, "contrato", "concesión") say
  // nothing about where a clause is; rare words say a lot.
  const documentFrequency = new Map<string, number>();
  for (const page of index) for (const token of page.tokens) documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
  const rarity = (term: string) => {
    let df = documentFrequency.get(term) ?? 0;
    if (df === 0 && term.length >= 6) for (const [token, count] of documentFrequency) if (token.length >= 6 && token[0] === term[0] && withinOneEdit(token, term)) df += count;
    return Math.log((index.length + 1) / (df + 1)) + 0.1;
  };

  const byField: Record<string, number[]> = {};
  const fieldScores = new Map<string, Map<number, number>>();
  const tocHits = new Map<string, Set<number>>();
  for (const field of fields) {
    const terms = termsFor(field);
    const ownWeight = new Map(terms.own.map((term) => [term, rarity(term)]));
    const hintWeight = new Map(terms.hints.map((term) => [term, rarity(term)]));
    const labelWords = contentWords(field.label);
    const phrase = ` ${labelWords.join(" ")} `;
    const pairs = labelWords.slice(1).map((word, i) => ` ${labelWords[i]} ${word} `);
    const scores = new Map<number, number>();
    for (const page of index) {
      let score = 0;
      for (const [term, weight] of ownWeight) if (pageHas(page, term)) score += 4 * weight;
      for (const [term, weight] of hintWeight) if (pageHas(page, term)) score += 0.6 * weight;
      // The clause heading itself ("plazo de la concesion", "fiel cumplimiento") is the strongest hint of all.
      if (labelWords.length >= 2 && page.flat.includes(phrase)) score += 10;
      else if (pairs.some((pair) => page.flat.includes(pair))) score += 5;
      if (score > 0) scores.set(page.pageNumber, score);
    }
    // Index entries whose title shares words with the field point at a page and the next one.
    const fromToc = new Set<number>();
    for (const entry of toc) {
      const titleWords = normalizeWords(entry.title);
      const own = terms.own.filter((term) => titleWords.some((word) => withinOneEdit(word, term))).length;
      const hints = terms.hints.filter((term) => titleWords.includes(term)).length;
      if (own === 0 && hints < 2) continue;
      for (const page of [entry.docPage + offset, entry.docPage + offset + 1]) {
        if (!byNumber.has(page)) continue;
        scores.set(page, (scores.get(page) ?? 0) + 6 + own * 3);
        fromToc.add(page);
      }
    }
    tocHits.set(field.fieldKey, fromToc);
    fieldScores.set(field.fieldKey, scores);
    byField[field.fieldKey] = [...scores.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([page]) => page);
  }

  // Every field gets its best page first, then the page after it (clauses
  // spill over), then second choices, so one keyword-heavy field cannot crowd
  // the others out.
  const ranked = fields.map((field) => ({ field, pages: byField[field.fieldKey] ?? [] }));
  for (let depth = 0; depth < 3 && selected.size < maxPages; depth++) {
    for (const { field, pages: candidates } of ranked) {
      const page = candidates[depth];
      if (page === undefined || selected.size >= maxPages) continue;
      if (!selected.has(page)) selected.add(page);
      add(page, `${field.fieldKey}${tocHits.get(field.fieldKey)?.has(page) ? " · índice" : ""}`);
    }
    if (depth === 0) {
      for (const { field, pages: candidates } of ranked) {
        const next = candidates[0] === undefined ? undefined : candidates[0] + 1;
        if (next === undefined || selected.size >= maxPages || !byNumber.has(next)) continue;
        if (!selected.has(next)) { selected.add(next); add(next, `${field.fieldKey} · continuación`); }
      }
    }
  }
  if (selected.size < maxPages) {
    const totals = new Map<number, number>();
    for (const scores of fieldScores.values()) for (const [page, score] of scores) totals.set(page, (totals.get(page) ?? 0) + score);
    for (const [page] of [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])) {
      if (selected.size >= maxPages) break;
      if (!selected.has(page)) { selected.add(page); add(page, "coincidencias"); }
    }
  }
  return { pages: [...selected].sort((a, b) => a - b), byField, reasons };
}

/** Why a page scores for a field: the words and phrases that matched. For traces and tests. */
export function explainField(pages: IndexedPageText[], field: FieldDef, pageNumber: number): { own: string[]; hints: string[]; phrase: boolean; pairs: string[] } {
  const page = pages.find((candidate) => candidate.pageNumber === pageNumber);
  if (!page) return { own: [], hints: [], phrase: false, pairs: [] };
  const indexed = indexPage(page);
  const terms = termsFor(field);
  const labelWords = contentWords(field.label);
  const pairs = labelWords.slice(1).map((word, i) => ` ${labelWords[i]} ${word} `);
  return {
    own: terms.own.filter((term) => pageHas(indexed, term)),
    hints: terms.hints.filter((term) => pageHas(indexed, term)),
    phrase: labelWords.length >= 2 && indexed.flat.includes(` ${labelWords.join(" ")} `),
    pairs: pairs.filter((pair) => indexed.flat.includes(pair)).map((pair) => pair.trim()),
  };
}

/** Next candidate pages for the given fields, skipping pages already sent. */
export function widenPages(located: LocatedPages, fieldKeys: string[], exclude: Iterable<number>, count = 8): number[] {
  const used = new Set(exclude);
  const out: number[] = [];
  for (let depth = 0; out.length < count; depth++) {
    let any = false;
    for (const key of fieldKeys) {
      const page = located.byField[key]?.[depth];
      if (page === undefined) continue;
      any = true;
      if (!used.has(page)) { used.add(page); out.push(page); if (out.length >= count) break; }
    }
    if (!any) break;
  }
  return out.sort((a, b) => a - b);
}

/** Renders the chosen pages as labelled text within a character budget. */
export function pagesText(pages: IndexedPageText[], pageNumbers: number[], maxChars = 60_000, perPage = 12_000): string {
  const byNumber = new Map(pages.map((page) => [page.pageNumber, page.text.trim()]));
  const out: string[] = [];
  let used = 0;
  for (const number of pageNumbers) {
    const text = byNumber.get(number);
    if (!text) continue;
    const room = maxChars - used - 20;
    if (room < 200) break;
    const slice = text.slice(0, Math.min(perPage, room));
    out.push(`[Página ${number}]\n${slice}`);
    used += slice.length + 20;
  }
  return out.join("\n\n");
}

/** Convenience: locate and render in one step (bounded by characters, as the older callers expect). */
export function selectPagesForFields(pages: IndexedPageText[], fields: FieldDef[], maxChars = 60_000, options: LocateOptions = {}): string {
  const located = locatePages(pages, fields, { maxPages: 12, ...options });
  // Priority order for the budget: fixed pages and best matches first; the
  // output itself stays in reading order.
  const priority = [...new Set([
    ...located.pages.filter((page) => located.reasons[page]?.some((reason) => reason === "portada")),
    ...fields.flatMap((field) => located.byField[field.fieldKey]?.slice(0, 1) ?? []),
    ...located.pages,
  ])].filter((page) => located.pages.includes(page));
  const byNumber = new Map(pages.map((page) => [page.pageNumber, page.text.trim()]));
  const chosen: number[] = [];
  let used = 0;
  for (const page of priority) {
    const text = byNumber.get(page) ?? "";
    const room = maxChars - used - 20;
    if (room < 200) break;
    chosen.push(page);
    used += Math.min(text.length, 12_000, room) + 20;
  }
  return pagesText(pages, chosen.sort((a, b) => a - b), maxChars);
}

export function fieldBatches<T>(fields: T[], size = 7): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < fields.length; i += size) batches.push(fields.slice(i, i + size));
  return batches;
}
