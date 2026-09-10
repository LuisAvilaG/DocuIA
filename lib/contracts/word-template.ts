import PizZip from "pizzip";

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

type TextPart = { open: string; text: string; close: string };

function replaceInParagraph(paragraph: string, anchor: string, replacement: string): string {
  if (!anchor) return paragraph;
  const token = /(<w:t\b[^>]*>)([\s\S]*?)(<\/w:t>)/g;
  const parts: TextPart[] = [];
  let match: RegExpExecArray | null;
  while ((match = token.exec(paragraph))) parts.push({ open: match[1], text: decodeXml(match[2]), close: match[3] });
  const whole = parts.map((part) => part.text).join("");
  if (!whole.includes(anchor)) return paragraph;

  let cursor = 0;
  const rewritten = parts.map((part) => {
    const start = cursor;
    cursor += part.text.length;
    return { ...part, start, end: cursor };
  });

  // A label may appear in more than one part of a document. Replacing all
  // occurrences is deliberate: headers and signature tables normally need
  // the same value. Within one paragraph, preserve the style of the first run.
  const occurrences: number[] = [];
  let from = whole.indexOf(anchor);
  while (from >= 0) {
    occurrences.push(from);
    from = whole.indexOf(anchor, from + anchor.length);
  }

  // Work from the end so a longer replacement never shifts the positions of
  // an earlier occurrence in this paragraph.
  for (const occurrence of occurrences.reverse()) {
    const from = occurrence;
    const to = from + anchor.length;
    for (const part of rewritten) {
      const overlapStart = Math.max(from, part.start);
      const overlapEnd = Math.min(to, part.end);
      if (overlapStart >= overlapEnd) continue;
      const localStart = overlapStart - part.start;
      const localEnd = overlapEnd - part.start;
      const beginsHere = from >= part.start && from < part.end;
      part.text = part.text.slice(0, localStart) + (beginsHere ? replacement : "") + part.text.slice(localEnd);
    }
  }

  let i = 0;
  return paragraph.replace(token, () => {
    const part = rewritten[i++];
    return `${part.open}${encodeXml(part.text)}${part.close}`;
  });
}

function replaceTextInXml(xml: string, anchor: string, replacement: string): string {
  return xml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (paragraph) => replaceInParagraph(paragraph, anchor, replacement));
}

function visibleText(xml: string): string {
  return [...xml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map((match) => decodeXml(match[1])).join("");
}

function printableCell(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return value.toLocaleString("es-CO", { maximumFractionDigits: 6 });
  return printable(value);
}

function numericValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!/^\$?\s*[\d.,]+$/.test(raw)) return null;
  const stripped = raw.replace(/[^\d.,]/g, "");
  const separator = Math.max(stripped.lastIndexOf(","), stripped.lastIndexOf("."));
  const decimals = separator >= 0 ? stripped.length - separator - 1 : 0;
  const normalized = decimals === 3 || (stripped.match(/[.,]/g)?.length ?? 0) > 1
    ? stripped.replace(/[.,]/g, "")
    : separator >= 0
      ? stripped.replace(/[.,]/g, (part, index) => index === separator ? "." : "")
      : stripped;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
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
  const rows = Array.isArray(input)
    ? input.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    : [];

  return xml.replace(/<w:tr\b[\s\S]*?<\/w:tr>/g, (tableRow) => {
    if (!visibleText(tableRow).includes(repeat.rowAnchorText)) return tableRow;
    if (!rows.length) return replaceTextInXml(tableRow, repeat.rowAnchorText, "[POR COMPLETAR]");

    return rows.map((item, index) => {
      let copy = replaceTextInXml(tableRow, repeat.rowAnchorText, "");
      const tokens = [...new Set([...visibleText(copy).matchAll(/\{\{\s*(?:item\.)?([\w.-]+)\s*\}\}/g)].map((match) => match[1]))];
      for (const token of tokens) {
        // Tokens that are not properties of an item may be ordinary case
        // fields (for example {{valor_contrato}}). Leave them for the normal
        // template mapping pass that runs after table expansion.
        if (token !== "index" && !(token in item)) continue;
        const replacement = token === "index" ? String(index + 1) : printableCell(item[token]);
        copy = replaceTextInXml(copy, `{{${token}}}`, replacement);
        copy = replaceTextInXml(copy, `{{item.${token}}}`, replacement);
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
