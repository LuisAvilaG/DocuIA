import { PDFDocument, StandardFonts, rgb, type PDFFont, type RGB } from "pdf-lib";
import { parse, HTMLElement } from "node-html-parser";

// ── Template engine ───────────────────────────────────────────────────
// Replaces {{ key }} placeholders with data. Missing/empty values become
// [POR COMPLETAR] — the system never invents data. Lists are joined.

const PLACEHOLDER = "[POR COMPLETAR]";

// WinAnsi (Helvetica) can't encode characters outside Latin-1. Map common symbols
// to ASCII and drop the rest so PDF generation never crashes on real extracted data.
function pdfSafe(s: string): string {
  return s
    .replace(/[−–—]/g, "-").replace(/…/g, "...").replace(/∞/g, "inf")
    .replace(/≤/g, "<=").replace(/≥/g, ">=").replace(/↔/g, "<->").replace(/→/g, "->")
    .replace(/[""]/g, '"').replace(/['']/g, "'").replace(/•/g, "-")
    .replace(/[^\x00-\xFF]/g, "?");
}

function flatten(v: unknown): string {
  if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean).join(", ");
  if (v === null || v === undefined) return "";
  return String(v);
}

export function renderTemplate(
  body: string,
  data: Record<string, unknown>,
): { text: string; missing: string[] } {
  const missing: string[] = [];
  const text = body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => {
    const val = flatten(data[key]);
    if (!val) { if (!missing.includes(key)) missing.push(key); return PLACEHOLDER; }
    return val;
  });
  return { text, missing };
}

// Built-in default template when the org has not configured one.
export function defaultTemplate(data: Record<string, unknown>): string {
  const lines = ["RESUMEN DEL ANÁLISIS DOCUMENTAL", ""];
  for (const [k, v] of Object.entries(data)) {
    if (k.startsWith("_")) continue;
    lines.push(`${k}: ${flatten(v) || PLACEHOLDER}`);
  }
  return lines.join("\n");
}

// ── PDF rendering (server-side, no headless browser) ──────────────────
export interface PdfOptions {
  title?: string;
  letterheadPng?: Buffer | Uint8Array;  // optional full-page background
}

export async function renderPdf(text: string, opts: PdfOptions = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const letterhead = opts.letterheadPng ? await doc.embedPng(opts.letterheadPng).catch(() => null) : null;

  const PAGE_W = 612, PAGE_H = 792;      // US Letter
  const MARGIN_X = 56, MARGIN_TOP = 96, MARGIN_BOT = 64;
  const SIZE = 10, LEADING = 14;
  const maxWidth = PAGE_W - MARGIN_X * 2;

  let page = doc.addPage([PAGE_W, PAGE_H]);
  if (letterhead) page.drawImage(letterhead, { x: 0, y: 0, width: PAGE_W, height: PAGE_H });
  let y = PAGE_H - MARGIN_TOP;

  const newPage = () => {
    page = doc.addPage([PAGE_W, PAGE_H]);
    if (letterhead) page.drawImage(letterhead, { x: 0, y: 0, width: PAGE_W, height: PAGE_H });
    y = PAGE_H - MARGIN_TOP;
  };

  // Wrap a single logical line to the page width.
  const wrap = (rawLine: string, f = font): string[] => {
    const line = pdfSafe(rawLine);
    if (!line) return [""];
    const words = line.split(/\s+/);
    const out: string[] = [];
    let cur = "";
    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w;
      if (f.widthOfTextAtSize(test, SIZE) > maxWidth && cur) { out.push(cur); cur = w; }
      else cur = test;
    }
    if (cur) out.push(cur);
    return out;
  };

  if (opts.title) {
    for (const l of wrap(opts.title, bold)) {
      if (y < MARGIN_BOT) newPage();
      page.drawText(l, { x: MARGIN_X, y, size: 13, font: bold, color: rgb(0.08, 0.24, 0.44) });
      y -= LEADING + 4;
    }
    y -= 6;
  }

  for (const rawLine of text.split("\n")) {
    const wrapped = wrap(rawLine);
    for (const l of wrapped) {
      if (y < MARGIN_BOT) newPage();
      page.drawText(l, { x: MARGIN_X, y, size: SIZE, font, color: rgb(0.1, 0.1, 0.12) });
      y -= LEADING;
    }
  }

  return doc.save();
}

// ── Rich document model (WYSIWYG builder → PDF) ───────────────────────
export type DocBlock =
  | { type: "heading"; text: string }
  | { type: "text";    text: string }
  | { type: "table";   rows: string[][] };
export interface ContractDoc { brandColor?: string; logo?: string; blocks: DocBlock[] }

function hexToRgb(hex?: string) {
  const m = (hex ?? "").replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  return m ? rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255) : null;
}

// Render the block document to a PDF (server-side, pdf-lib — no headless browser).
// Supports a logo, a brand color for headings, paragraphs with {{field}} tokens,
// and bordered tables whose cells are token-substituted.
export async function renderDocPdf(
  model: ContractDoc,
  data: Record<string, unknown>,
  opts: { title?: string } = {},
): Promise<{ bytes: Uint8Array; missing: string[] }> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const brand = hexToRgb(model.brandColor) ?? rgb(0.08, 0.24, 0.44);
  const ink = rgb(0.1, 0.1, 0.12);

  const PAGE_W = 612, PAGE_H = 792, MARGIN_X = 56, MARGIN_TOP = 72, MARGIN_BOT = 56;
  const maxWidth = PAGE_W - MARGIN_X * 2;
  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN_TOP;
  const missing: string[] = [];
  const sub = (t: string) => { const r = renderTemplate(t, data); for (const k of r.missing) if (!missing.includes(k)) missing.push(k); return r.text; };
  const newPage = () => { page = pdf.addPage([PAGE_W, PAGE_H]); y = PAGE_H - MARGIN_TOP; };
  const ensure = (h: number) => { if (y - h < MARGIN_BOT) newPage(); };
  const wrap = (text: string, size: number, f = font, width = maxWidth): string[] => {
    const out: string[] = [];
    for (const raw of pdfSafe(text).split("\n")) {
      if (!raw) { out.push(""); continue; }
      let cur = "";
      for (const w of raw.split(/\s+/)) {
        const test = cur ? `${cur} ${w}` : w;
        if (f.widthOfTextAtSize(test, size) > width && cur) { out.push(cur); cur = w; } else cur = test;
      }
      if (cur) out.push(cur);
    }
    return out;
  };

  // Optional logo (data URL) at the top.
  if (model.logo) {
    const m = model.logo.match(/^data:image\/(png|jpe?g);base64,(.+)$/i);
    if (m) {
      try {
        const bytes = Buffer.from(m[2], "base64");
        const img = m[1].toLowerCase().startsWith("png") ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
        const w = Math.min(150, img.width), h = (img.height / img.width) * w;
        page.drawImage(img, { x: MARGIN_X, y: y - h, width: w, height: h });
        y -= h + 14;
      } catch { /* ignore bad image */ }
    }
  }

  if (opts.title) {
    for (const l of wrap(opts.title, 15, bold)) { ensure(20); page.drawText(l, { x: MARGIN_X, y, size: 15, font: bold, color: brand }); y -= 20; }
    y -= 6;
  }

  for (const block of model.blocks) {
    if (block.type === "heading") {
      y -= 4;
      for (const l of wrap(sub(block.text), 12, bold)) { ensure(17); page.drawText(l, { x: MARGIN_X, y, size: 12, font: bold, color: brand }); y -= 17; }
      y -= 2;
    } else if (block.type === "text") {
      for (const l of wrap(sub(block.text), 10)) { ensure(14); page.drawText(l, { x: MARGIN_X, y, size: 10, font, color: ink }); y -= 14; }
      y -= 4;
    } else if (block.type === "table") {
      const rows = block.rows.filter((r) => r.length);
      if (!rows.length) continue;
      const cols = Math.max(...rows.map((r) => r.length));
      const colW = maxWidth / cols;
      const pad = 5;
      rows.forEach((row, ri) => {
        const cells = Array.from({ length: cols }, (_, ci) => wrap(sub(row[ci] ?? ""), 9, ri === 0 ? bold : font, colW - pad * 2));
        const rowH = Math.max(18, Math.max(...cells.map((c) => c.length)) * 12 + pad * 2);
        ensure(rowH);
        const top = y;
        for (let ci = 0; ci < cols; ci++) {
          const x = MARGIN_X + ci * colW;
          if (ri === 0) page.drawRectangle({ x, y: top - rowH, width: colW, height: rowH, color: brand, opacity: 0.08 });
          page.drawRectangle({ x, y: top - rowH, width: colW, height: rowH, borderColor: rgb(0.8, 0.8, 0.82), borderWidth: 0.75 });
          let ty = top - pad - 8;
          for (const line of cells[ci]) { page.drawText(line, { x: x + pad, y: ty, size: 9, font: ri === 0 ? bold : font, color: ink }); ty -= 12; }
        }
        y = top - rowH;
      });
      y -= 6;
    }
  }
  return { bytes: await pdf.save(), missing };
}

// ── HTML → PDF (WYSIWYG editor output) ────────────────────────────────
// Renders editor HTML with node-html-parser + pdf-lib (no headless browser):
// h1-h3, p/div, ul/ol/li, tables, images, and inline bold/italic/color.
export async function renderHtmlPdf(
  html: string,
  data: Record<string, unknown>,
  opts: { title?: string } = {},
): Promise<{ bytes: Uint8Array; missing: string[] }> {
  const rendered = renderTemplate(html, data);
  const root = parse(rendered.text);

  const pdf = await PDFDocument.create();
  const fonts = {
    n:  await pdf.embedFont(StandardFonts.Helvetica),
    b:  await pdf.embedFont(StandardFonts.HelveticaBold),
    i:  await pdf.embedFont(StandardFonts.HelveticaOblique),
    bi: await pdf.embedFont(StandardFonts.HelveticaBoldOblique),
  };
  const ink = rgb(0.1, 0.1, 0.12);
  const PAGE_W = 612, PAGE_H = 792, MARGIN_X = 56, MARGIN_TOP = 64, MARGIN_BOT = 56;
  const maxWidth = PAGE_W - MARGIN_X * 2;
  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN_TOP;
  const newPage = () => { page = pdf.addPage([PAGE_W, PAGE_H]); y = PAGE_H - MARGIN_TOP; };
  const ensure = (h: number) => { if (y - h < MARGIN_BOT) newPage(); };

  interface Style { bold?: boolean; italic?: boolean; color?: RGB }
  interface Run { text: string; st: Style }
  const fontFor = (st: Style): PDFFont => st.bold && st.italic ? fonts.bi : st.bold ? fonts.b : st.italic ? fonts.i : fonts.n;
  const parseColor = (v?: string | null): RGB | undefined => {
    if (!v) return undefined;
    let m = v.match(/#([0-9a-f]{6})/i);
    if (m) return rgb(parseInt(m[1].slice(0, 2), 16) / 255, parseInt(m[1].slice(2, 4), 16) / 255, parseInt(m[1].slice(4, 6), 16) / 255);
    m = v.match(/rgb\((\d+)[,\s]+(\d+)[,\s]+(\d+)\)/i);
    if (m) return rgb(Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255);
    return undefined;
  };

  const collect = (node: HTMLElement, st: Style, out: Run[]) => {
    for (const child of node.childNodes) {
      if (child instanceof HTMLElement) {
        const tag = (child.tagName || "").toLowerCase();
        if (tag === "br") { out.push({ text: "\n", st }); continue; }
        const ns: Style = { ...st };
        if (tag === "b" || tag === "strong") ns.bold = true;
        if (tag === "i" || tag === "em") ns.italic = true;
        const col = parseColor(child.getAttribute("style")) ?? parseColor(child.getAttribute("color"));
        if (col) ns.color = col;
        collect(child, ns, out);
      } else {
        const t = (child as { text?: string }).text ?? "";
        if (t) out.push({ text: t, st });
      }
    }
  };

  const drawRuns = (runs: Run[], size: number, leading: number, indent = 0) => {
    const x0 = MARGIN_X + indent, maxW = maxWidth - indent;
    let lineWords: { t: string; f: PDFFont; w: number; color: RGB }[] = [];
    let lineW = 0;
    const flush = () => {
      ensure(leading);
      let x = x0;
      for (const w of lineWords) { page.drawText(w.t, { x, y, size, font: w.f, color: w.color }); x += w.w; }
      y -= leading; lineWords = []; lineW = 0;
    };
    for (const r of runs) {
      const f = fontFor(r.st), color = r.st.color ?? ink;
      for (const p of pdfSafe(r.text).split(/(\s+|\n)/)) {
        if (p === "") continue;
        if (p === "\n") { flush(); continue; }
        const w = f.widthOfTextAtSize(p, size);
        if (lineW + w > maxW && lineWords.length) flush();
        lineWords.push({ t: p, f, w, color }); lineW += w;
      }
    }
    if (lineWords.length) flush();
  };

  const drawImage = async (el: HTMLElement) => {
    const m = (el.getAttribute("src") ?? "").match(/^data:image\/(png|jpe?g);base64,(.+)$/i);
    if (!m) return;
    try {
      const bytes = Buffer.from(m[2], "base64");
      const img = m[1].toLowerCase().startsWith("png") ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
      const w = Math.min(maxWidth, img.width), h = (img.height / img.width) * w;
      ensure(h + 8); page.drawImage(img, { x: MARGIN_X, y: y - h, width: w, height: h }); y -= h + 8;
    } catch { /* ignore bad image */ }
  };

  const drawTable = (el: HTMLElement) => {
    const trs = el.querySelectorAll("tr");
    if (!trs.length) return;
    const cols = Math.max(...trs.map((tr) => tr.querySelectorAll("td,th").length));
    if (!cols) return;
    const colW = maxWidth / cols;
    trs.forEach((tr, ri) => {
      const cells = tr.querySelectorAll("td,th");
      const wrapped = Array.from({ length: cols }, (_, ci) => {
        const runs: Run[] = []; if (cells[ci]) collect(cells[ci], {}, runs);
        const text = pdfSafe(runs.map((r) => r.text).join("")).replace(/\s+/g, " ").trim();
        const lines: string[] = []; let cur = "";
        for (const wd of text.split(" ").filter(Boolean)) { const test = cur ? `${cur} ${wd}` : wd; if (fonts.n.widthOfTextAtSize(test, 9) > colW - 8 && cur) { lines.push(cur); cur = wd; } else cur = test; }
        if (cur) lines.push(cur); return lines.length ? lines : [""];
      });
      const rowH = Math.max(16, Math.max(...wrapped.map((c) => c.length)) * 11 + 8);
      ensure(rowH);
      const top = y;
      for (let ci = 0; ci < cols; ci++) {
        const x = MARGIN_X + ci * colW;
        if (ri === 0) page.drawRectangle({ x, y: top - rowH, width: colW, height: rowH, color: rgb(0.94, 0.95, 0.96) });
        page.drawRectangle({ x, y: top - rowH, width: colW, height: rowH, borderColor: rgb(0.8, 0.8, 0.82), borderWidth: 0.75 });
        let ty = top - 12;
        for (const ln of wrapped[ci]) { page.drawText(ln, { x: x + 4, y: ty, size: 9, font: ri === 0 ? fonts.b : fonts.n, color: ink }); ty -= 11; }
      }
      y = top - rowH;
    });
    y -= 6;
  };

  const renderBlock = async (node: HTMLElement | { text?: string }) => {
    if (!(node instanceof HTMLElement)) { const t = node.text?.trim(); if (t) drawRuns([{ text: t, st: {} }], 10, 14); return; }
    const tag = (node.tagName || "").toLowerCase();
    if (tag === "h1" || tag === "h2" || tag === "h3") {
      const size = tag === "h1" ? 16 : tag === "h2" ? 13 : 11;
      const runs: Run[] = []; collect(node, { bold: true }, runs);
      y -= 4; drawRuns(runs, size, size + 5); y -= 2;
    } else if (tag === "ul" || tag === "ol") {
      let idx = 1;
      for (const li of node.querySelectorAll("li")) {
        const runs: Run[] = []; collect(li, {}, runs);
        drawRuns([{ text: tag === "ol" ? `${idx++}. ` : "-  ", st: {} }, ...runs], 10, 14, 12);
      }
      y -= 4;
    } else if (tag === "table") { drawTable(node); }
    else if (tag === "img") { await drawImage(node); }
    else {
      const runs: Run[] = []; collect(node, {}, runs);
      if (runs.length) { drawRuns(runs, 10, 14); y -= 4; } else { y -= 8; }
      for (const img of node.querySelectorAll("img")) await drawImage(img);
    }
  };

  if (opts.title) { drawRuns([{ text: opts.title, st: { bold: true } }], 15, 20); y -= 6; }
  for (const b of root.childNodes) await renderBlock(b as HTMLElement);

  return { bytes: await pdf.save(), missing: rendered.missing };
}

// Assemble a flat data object for the template from a case's extracted docs +
// validations. Later documents of the same field win last-writer.
export function assembleCaseData(
  docs: Array<{ detectedType: string | null; extractedJson: unknown }>,
  validations: Array<{ subject: string; status: string; reason: string | null }>,
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const d of docs) {
    const values = (d.extractedJson ?? {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(values)) {
      data[k] = v;
      if (d.detectedType) data[`${d.detectedType}.${k}`] = v;
    }
  }
  data._validations = validations.map((v) => `${v.subject}: ${v.status}${v.reason ? ` — ${v.reason}` : ""}`);
  return data;
}
