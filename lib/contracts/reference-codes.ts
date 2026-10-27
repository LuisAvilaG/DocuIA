export interface IndexedPageText {
  pageNumber: number;
  text: string;
}

export interface DetectedReference {
  rawCode: string;
  normalizedCode: string;
  pageNumber: number;
  context: string;
}

// Intentionally requires a document prefix and a year. Dates, clause numbers
// and standalone invoice amounts must never turn into correspondence links.
const CODE = /\b(?:CARTA|OFICIO|INFORME|TRANSMITTAL|TRANS|MEMORANDO|DOCUMENTO)\s*(?:N\s*[°º.o]*\s*)?[-:/]?\s*\d{1,6}\s*[-/]\s*(?:20)?\d{2}\b|\b[A-Z][A-Z0-9]{1,14}(?:[-/][A-Z0-9]{1,14}){0,3}[-/]\d{1,6}[-/](?:20)?\d{2}\b/gi;

export function normalizeReferenceCode(raw: string): string {
  return raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\bN\s*[°º.O]*\s*(?=\d)/g, "")
    .replace(/[^A-Z0-9]/g, "");
}

export function detectDocumentType(fileName: string, firstPage: string): string {
  const patterns = [
    ["transmittal", /TRANSMITTAL|\bTRANS[-\s/]/],
    ["informe", /\bINFORME\b/],
    ["oficio", /\bOFICIO\b/],
    ["carta", /\bCARTA\b/],
  ] as const;
  // The first type in the filename/header names the document; later mentions
  // usually describe documents being cited, not the document being indexed.
  for (const probe of [fileName, firstPage.slice(0, 500)]) {
    const upper = probe.toUpperCase();
    const first = patterns.map(([type, pattern]) => ({ type, at: upper.search(pattern) }))
      .filter((hit) => hit.at >= 0).sort((a, b) => a.at - b.at)[0];
    if (first) return first.type;
  }
  return "otro";
}

export function detectOwnCode(fileName: string, firstPage: string): string | null {
  // The heading is stronger evidence than arbitrary references in the body.
  const heading = firstPage.slice(0, 1200);
  const headingMatch = [...heading.matchAll(CODE)][0]?.[0];
  const fileMatch = [...fileName.matchAll(CODE)][0]?.[0];
  return (headingMatch || fileMatch || null)?.trim() ?? null;
}

export function detectReferences(pages: IndexedPageText[], ownCode: string | null, max = 150): DetectedReference[] {
  const own = ownCode ? normalizeReferenceCode(ownCode) : null;
  const found = new Map<string, DetectedReference>();
  for (const page of pages) {
    for (const match of page.text.matchAll(CODE)) {
      const rawCode = match[0].replace(/\s+/g, " ").trim();
      const normalizedCode = normalizeReferenceCode(rawCode);
      if (!normalizedCode || normalizedCode === own || found.has(normalizedCode)) continue;
      const start = Math.max(0, (match.index ?? 0) - 140);
      const end = Math.min(page.text.length, (match.index ?? 0) + match[0].length + 180);
      const context = page.text.slice(start, end).replace(/\s+/g, " ").trim();
      found.set(normalizedCode, { rawCode, normalizedCode, pageNumber: page.pageNumber, context });
      if (found.size >= max) return [...found.values()];
    }
  }
  return [...found.values()];
}

export function excerptForRelevance(text: string, max = 2800): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}
