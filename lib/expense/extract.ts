/**
 * OCR extraction for expense documents.
 * Specialized for: invoices, receipts, cuentas de cobro — including phone photos.
 * Returns structured fields + per-field confidence + detected document type.
 */

import { generateJson } from "@/lib/ai/provider";

export type ExpenseDocumentType = "invoice" | "receipt" | "cuenta_cobro" | "documento_equivalente" | "unknown";

export interface ExpenseOcrResult {
  documentType:    ExpenseDocumentType;
  vendorName:      string | null;
  vendorNit:       string | null;
  invoiceNumber:   string | null;
  invoiceDate:     string | null;
  subtotal:        number | null;
  taxAmount:       number | null;
  retentionAmount: number | null;
  total:           number | null;
  currency:        string;
  confidence:      number;           // 0–1 overall
  fieldConfidence: Record<string, number>;
  raw:             Record<string, unknown>;
}

function normalize(v: unknown): string {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}

function toNumber(v: unknown): number | null {
  let s = String(v ?? "").replace(/[$€£¥\s]/g, "").trim();
  if (!s) return null;

  // European format: 1.234,56 or 1.234 (dot = thousands, comma = decimal)
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) {
    s = s.replace(/\./g, "").replace(",", ".");
  // US format: 1,234.56 or 1,234 (comma = thousands, dot = decimal)
  } else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) {
    s = s.replace(/,/g, "");
  } else {
    // Ambiguous single comma — strip it (treat as thousands separator)
    s = s.replace(/,/g, "");
  }

  s = s.replace(/[^\d.\-]/g, "");
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function detectDocType(raw: Record<string, unknown>): ExpenseDocumentType {
  const docTypeRaw = normalize(raw.document_type).toLowerCase();
  if (docTypeRaw.includes("factura") || docTypeRaw.includes("invoice") || docTypeRaw.includes("cfdi") || docTypeRaw.includes("dte")) return "invoice";
  if (docTypeRaw.includes("cuenta") && docTypeRaw.includes("cobro")) return "cuenta_cobro";
  if (docTypeRaw.includes("equivalente")) return "documento_equivalente";
  if (docTypeRaw.includes("recibo") || docTypeRaw.includes("receipt") || docTypeRaw.includes("ticket") || docTypeRaw.includes("voucher")) return "receipt";
  return "unknown";
}

function computeConfidence(fields: Record<string, number>): number {
  const critical = ["vendorNit", "invoiceNumber", "total", "invoiceDate"];
  const criticalScores = critical.map((k) => fields[k] ?? 0);
  const avg = criticalScores.reduce((a, b) => a + b, 0) / critical.length;
  return parseFloat(avg.toFixed(3));
}

function scoreField(value: unknown): number {
  if (value === null || value === undefined || value === "" || value === 0) return 0;
  if (typeof value === "number" && value > 0) return 1;
  const s = String(value).trim();
  if (!s) return 0;
  if (s.length < 3) return 0.4;
  return 1;
}

function getInstruction(): string {
  return [
    "Extract data from this expense document (invoice, receipt, or account statement).",
    "The image may be a phone photo with imperfect quality — do your best.",
    "Return ONLY a strict JSON object, no markdown, no comments.",
    "Use null for any field you cannot read clearly.",
    "For document_type, classify as one of: invoice, receipt, cuenta_cobro, documento_equivalente, unknown.",
    "For vendor_nit, extract the tax ID (NIT for Colombia, RFC for Mexico, RUT for Chile). Include dígito de verificación if present.",
    "For amounts, return as plain numbers (integer or decimal) using dot as decimal separator. No currency symbols, no commas, no dots as thousands separators. Example: 1610 not 1.610 or 1,610.",
    "Schema:",
    JSON.stringify({
      document_type:    "invoice|receipt|cuenta_cobro|documento_equivalente|unknown",
      vendor_name:      "string|null",
      vendor_nit:       "string|null",
      invoice_number:   "string|null",
      invoice_date:     "string|null — format: YYYY-MM-DD",
      subtotal:         "number|null",
      tax_amount:       "number|null — sum of all taxes (IVA, etc.)",
      retention_amount: "number|null — sum of all retentions (if shown)",
      total:            "number|null",
      currency:         "string — ISO 4217 code e.g. COP, MXN, USD",
    }),
  ].join(" ");
}

/** Modelo del OCR de gastos. Claude lee PDF, JPG, PNG, WEBP y GIF; otros formatos de foto van a Gemini. */
export const EXPENSE_OCR_MODEL = "claude-haiku-5-5";
const CLAUDE_IMAGES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export function expenseOcrModel(mimeType: string, preferred = EXPENSE_OCR_MODEL): string {
  if (preferred.startsWith("claude") && mimeType !== "application/pdf" && !CLAUDE_IMAGES.has(mimeType)) return "gemini-2.5-flash";
  return preferred;
}

function parseJsonSafe(text: string): Record<string, unknown> {
  const raw = text.trim();
  try { return JSON.parse(raw); } catch { /* */ }
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) try { return JSON.parse(m[0]); } catch { /* */ }
  return {};
}

export async function extractExpenseDocument(
  fileBuffer: Buffer,
  mimeType:   string,
  options?:   { apiKey?: string; model?: string },
): Promise<ExpenseOcrResult> {
  const isImage = mimeType.startsWith("image/");
  const isPdf   = mimeType === "application/pdf";

  if (!isImage && !isPdf) {
    throw new Error(`Tipo de archivo no soportado para OCR: ${mimeType}`);
  }

  const { rawText } = await generateJson({
    model: expenseOcrModel(mimeType, options?.model),
    instruction: getInstruction(),
    parts: [{ kind: "file", base64: fileBuffer.toString("base64"), mimeType }],
    apiKey: options?.apiKey,
    maxOutputTokens: 4000,
    timeoutMs: 90_000,
  });
  const raw  = parseJsonSafe(rawText);

  const vendorName      = normalize(raw.vendor_name)     || null;
  const vendorNit       = normalize(raw.vendor_nit)      || null;
  const invoiceNumber   = normalize(raw.invoice_number)  || null;
  const invoiceDate     = normalize(raw.invoice_date)    || null;
  const subtotal        = toNumber(raw.subtotal);
  const taxAmount       = toNumber(raw.tax_amount);
  const retentionAmount = toNumber(raw.retention_amount);
  const total           = toNumber(raw.total);
  const currency        = normalize(raw.currency).toUpperCase() || "COP";
  const documentType    = detectDocType(raw);

  const fieldConfidence: Record<string, number> = {
    vendorName:      scoreField(vendorName),
    vendorNit:       scoreField(vendorNit),
    invoiceNumber:   scoreField(invoiceNumber),
    invoiceDate:     scoreField(invoiceDate),
    subtotal:        scoreField(subtotal),
    taxAmount:       scoreField(taxAmount),
    total:           scoreField(total),
    documentType:    documentType !== "unknown" ? 1 : 0.3,
  };

  const confidence = computeConfidence(fieldConfidence);

  return {
    documentType, vendorName, vendorNit, invoiceNumber,
    invoiceDate, subtotal, taxAmount, retentionAmount,
    total, currency, confidence, fieldConfidence, raw,
  };
}
