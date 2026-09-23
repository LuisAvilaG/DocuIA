import PizZip from "pizzip";
import { parseLocaleNumber } from "@/lib/numbers";

export interface WordTemplateMapping {
  id: string;
  /** Text selected in the uploaded template. Every matching occurrence is filled. */
  anchorText: string;
  fieldKey: string;
  fieldLabel: string;
  format?: "text" | "number" | "currency";
}

export interface WordTableRepeat {
  id: string;
  /** A marker inside one Word table row, for example {{repeat:guarantees}}. */
  rowAnchorText: string;
  /** A calculated list or other structured list from the case. */
  fieldKey: string;
  fieldLabel: string;
}

export interface WordTemplateConfig {
  storageKey: string;
  originalName: string;
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  mappings: WordTemplateMapping[];
  /** Rows duplicated once per element of a structured case result. */
  tableRepeats?: WordTableRepeat[];
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function encodeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

// A text run (<w:t>) or a tab/line break, which the preview shows as
// whitespace: selections that cross one must still match.
type TextPart = { open: string; text: string; close: string; breakTag?: string };

// <w:t/> (empty, self-closing) must not be read as an opening tag.
const TEXT_OR_BREAK = /(<w:t\b(?![^>]*\/>)[^>]*>)([\s\S]*?)(<\/w:t>)|<w:(?:tab|br|cr)\b[^>]*\/>/g;

// Anchor occurrences as [from, to) in `whole`. Exact first; otherwise compare
// with whitespace runs collapsed, because the template preview (where the
// anchor was selected) collapses tabs, breaks and repeated spaces.
function findOccurrences(whole: string, anchor: string): Array<[number, number]> {
  const exact: Array<[number, number]> = [];
  for (let at = whole.indexOf(anchor); at >= 0; at = whole.indexOf(anchor, at + anchor.length)) exact.push([at, at + anchor.length]);
  if (exact.length) return exact;

  const target = anchor.replace(/\s+/g, " ").trim();
  if (!target) return [];
  let collapsed = "";
  const origin: number[] = []; // collapsed index → original index
  for (let i = 0; i < whole.length; i++) {
    if (/\s/.test(whole[i])) {
      if (collapsed.endsWith(" ")) continue;
      collapsed += " ";
    } else {
      collapsed += whole[i];
    }
    origin.push(i);
  }
  const found: Array<[number, number]> = [];
  for (let at = collapsed.indexOf(target); at >= 0; at = collapsed.indexOf(target, at + target.length)) {
    found.push([origin[at], origin[at + target.length - 1] + 1]);
  }
  return found;
}

function replaceInParagraph(paragraph: string, anchor: string, replacement: string): string {
  if (!anchor) return paragraph;
  const parts: TextPart[] = [];
  for (const match of paragraph.matchAll(TEXT_OR_BREAK)) {
    parts.push(match[1]
      ? { open: match[1], text: decodeXml(match[2]), close: match[3] }
      : { open: "", text: /<w:tab\b/.test(match[0]) ? "\t" : "\n", close: "", breakTag: match[0] });
  }
  const whole = parts.map((part) => part.text).join("");
  const occurrences = findOccurrences(whole, anchor);
  if (!occurrences.length) return paragraph;

  let cursor = 0;
  const rewritten = parts.map((part) => {
    const start = cursor;
    cursor += part.text.length;
    return { ...part, start, end: cursor };
  });

  // A label may appear in more than one part of a document. Replacing all
  // occurrences is deliberate: headers and signature tables normally need
  // the same value. Within one paragraph, preserve the style of the first run.
  // Work from the end so a longer replacement never shifts the positions of
  // an earlier occurrence in this paragraph.
  for (const [from, to] of occurrences.reverse()) {
    const overlaps = (part: (typeof rewritten)[number]) => Math.max(from, part.start) < Math.min(to, part.end);
    // The value goes into the first text run of the selection; tabs/breaks
    // inside the selection are removed with the rest of the anchor.
    const host = rewritten.find((part) => !part.breakTag && overlaps(part));
    if (!host) continue;
    for (const part of rewritten) {
      if (!overlaps(part)) continue;
      const localStart = Math.max(from, part.start) - part.start;
      const localEnd = Math.min(to, part.end) - part.start;
      part.text = part.text.slice(0, localStart) + (part === host ? replacement : "") + part.text.slice(localEnd);
    }
  }

  let i = 0;
  return paragraph.replace(TEXT_OR_BREAK, () => {
    const part = rewritten[i++];
    if (part.breakTag) return part.text ? part.breakTag : "";
    return `${part.open}${encodeXml(part.text)}${part.close}`;
  });
}

function replaceTextInXml(xml: string, anchor: string, replacement: string): string {
  return xml.replace(/<w:p\b(?![^>]*\/>)[^>]*>[\s\S]*?<\/w:p>/g, (paragraph) => replaceInParagraph(paragraph, anchor, replacement));
}

function visibleText(xml: string): string {
  return [...xml.matchAll(/<w:t\b(?![^>]*\/>)[^>]*>([\s\S]*?)<\/w:t>/g)].map((match) => decodeXml(match[1])).join("");
}

function printableCell(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return value.toLocaleString("es-CO", { maximumFractionDigits: 6 });
  return printable(value);
}

function numericValue(value: unknown): number | null {
  if (typeof value === "string" && !/^\$?\s*-?[\d.,]+$/.test(value.trim())) return null;
  return parseLocaleNumber(value);
}

function printableMapping(value: unknown, format: WordTemplateMapping["format"]): string {
  if (!format || format === "text") return printable(value);
  const number = numericValue(value);
  if (number === null) return printable(value);
  const rendered = number.toLocaleString("es-CO", { maximumFractionDigits: 6 });
  return format === "currency" ? `COP ${rendered}` : rendered;
}

/**
 * Repeats a Word table row for every structured result in a case. The row
 * contains a marker such as {{repeat:guarantees}} and ordinary placeholders
 * such as {{amparo}}, {{cantidad}} and {{value}}. This preserves the tenant's
 * native Word styling, widths and cell borders instead of rebuilding a table.
 */
function repeatTableRows(xml: string, repeat: WordTableRepeat, data: Record<string, unknown>): string {
  const input = data[repeat.fieldKey];
  // A list of plain values (e.g. asegurados: ["A", "B"]) repeats too; each
  // value is available as {{item}} or {{value}} in the row.
  const rows: Record<string, unknown>[] = Array.isArray(input)
    ? input
      .filter((item) => item !== null && item !== undefined && item !== "")
      .map((item) => typeof item === "object" ? item as Record<string, unknown> : { item, value: item })
    : [];

  return xml.replace(/<w:tr\b[\s\S]*?<\/w:tr>/g, (tableRow) => {
    if (!visibleText(tableRow).includes(repeat.rowAnchorText)) return tableRow;
    if (!rows.length) return replaceTextInXml(tableRow, repeat.rowAnchorText, "[POR COMPLETAR]");

    return rows.map((item, index) => {
      let copy = replaceTextInXml(tableRow, repeat.rowAnchorText, "");
      // Replace each placeholder exactly as written, so "{{ amparo }}" with
      // spaces is filled like "{{amparo}}".
      const placeholders = new Map([...visibleText(copy).matchAll(/\{\{\s*(?:item\.)?([\w.-]+)\s*\}\}/g)].map((match) => [match[0], match[1]]));
      for (const [placeholder, token] of placeholders) {
        // Tokens that are not properties of an item may be ordinary case
        // fields (for example {{valor_contrato}}). Leave them for the normal
        // template mapping pass that runs after table expansion.
        if (token !== "index" && !(token in item)) continue;
        const replacement = token === "index" ? String(index + 1) : printableCell(item[token]);
        copy = replaceTextInXml(copy, placeholder, replacement);
      }
      return copy;
    }).join("");
  });
}

function printable(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => printable(item)).filter(Boolean).join(", ");
  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    const label = String(row.amparo ?? row.nombre ?? row.name ?? row.concepto ?? "").trim();
    const calculated = row.value === null || row.value === undefined ? "" : String(row.value);
    if (label || calculated) return [label, calculated].filter(Boolean).join(": ");
    return Object.entries(row).filter(([key]) => key !== "evidence" && key !== "status").map(([key, item]) => `${key}: ${String(item ?? "")}`).join(" · ");
  }
  if (value === null || value === undefined || value === "") return "[POR COMPLETAR]";
  return String(value);
}

/**
 * Fills a Word document without flattening its layout. We only edit text runs
 * inside the DOCX package, keeping page setup, styles, headers, footers, logo
 * and tables intact. A mapping applies to the selected visible text in the
 * template and is intentionally safe when a field has no value.
 */
export function fillWordTemplate(source: Buffer, template: WordTemplateConfig, data: Record<string, unknown>): Buffer {
  const zip = new PizZip(source);
  const parts = Object.keys(zip.files).filter((name) => /^word\/.+\.xml$/i.test(name));
  for (const repeat of template.tableRepeats ?? []) {
    for (const path of parts) {
      const file = zip.file(path);
      if (!file) continue;
      const xml = file.asText();
      const replaced = repeatTableRows(xml, repeat, data);
      if (replaced !== xml) zip.file(path, replaced);
    }
  }
  for (const mapping of template.mappings) {
    const value = printableMapping(data[mapping.fieldKey], mapping.format);
    for (const path of parts) {
      const file = zip.file(path);
      if (!file) continue;
      const xml = file.asText();
      const replaced = replaceTextInXml(xml, mapping.anchorText, value);
      if (replaced !== xml) zip.file(path, replaced);
    }
  }
  return Buffer.from(zip.generate({ type: "nodebuffer", compression: "DEFLATE" }));
}

export function isWordTemplate(value: unknown): value is WordTemplateConfig {
  if (!value || typeof value !== "object") return false;
  const raw = value as Partial<WordTemplateConfig>;
  return typeof raw.storageKey === "string" && typeof raw.originalName === "string" && Array.isArray(raw.mappings)
    && (raw.tableRepeats === undefined || Array.isArray(raw.tableRepeats));
}
