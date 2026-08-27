import PizZip from "pizzip";

export interface WordTemplateMapping {
  id: string;
  /** Text selected in the uploaded template. Every matching occurrence is filled. */
  anchorText: string;
  fieldKey: string;
  fieldLabel: string;
}

export interface WordTemplateConfig {
  storageKey: string;
  originalName: string;
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  mappings: WordTemplateMapping[];
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

function printable(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => printable(item)).filter(Boolean).join(", ");
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
  for (const mapping of template.mappings) {
    const value = printable(data[mapping.fieldKey]);
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
  return typeof raw.storageKey === "string" && typeof raw.originalName === "string" && Array.isArray(raw.mappings);
}
