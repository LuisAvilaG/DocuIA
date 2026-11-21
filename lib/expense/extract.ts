/**
 * OCR extraction for expense documents.
 * Specialized for: invoices, receipts, cuentas de cobro — including phone photos.
 * Returns structured fields + per-field confidence + detected document type.
 */

import { generateJson } from "@/lib/ai/provider";
import { parseLocaleNumber } from "@/lib/numbers";

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

/**
 * Amount as the model returned it. Parsed as text on purpose, so a model that
 * answers 1.610 for "1.610" (thousands) is still read as 1610, and "45,90" is
 * 45.9 instead of 4590. An amount with exactly three decimals is therefore
 * read as thousands: on a receipt that is what it almost always is.
 */
export function toNumber(v: unknown): number | null {
  const n = parseLocaleNumber(String(v ?? ""));
  return n !== null && n >= 0 ? n : null;
}

/**
 * The amount exactly as the model wrote it in its answer. JSON.parse turns
 * `12.500` into 12.5 before anyone can read it as twelve thousand five hundred,
 * so the digits are taken from the text of the answer when they are there.
 */
export function amountFromAnswer(rawText: string, raw: Record<string, unknown>, key: string): number | null {
  const literal = rawText.match(new RegExp(`"${key}"\\s*:\\s*"?\\s*(-?[\\d.,]*\\d)`))?.[1];
  return toNumber(literal ?? raw[key]);
}

/** A date the form's date field can hold (YYYY-MM-DD), or none. */
export function toIsoDate(v: unknown): string | null {
  const text = normalize(v);
  const valid = (y: number, m: number, d: number) => {
    const date = new Date(Date.UTC(y, m - 1, d));
    return y > 1990 && y < 2100 && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
      ? `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null;
  };
  const iso = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) return valid(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  // Day first, as receipts in Latin America print it.
  const dmy = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/);
  if (dmy) return valid(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));
  return null;
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
  // Anything that is not a real date reaches the form as "no date": a date
  // field shows other text as empty while it still holds it, and saving failed.
  const invoiceDate     = toIsoDate(raw.invoice_date);
  const subtotal        = amountFromAnswer(rawText, raw, "subtotal");
  const taxAmount       = amountFromAnswer(rawText, raw, "tax_amount");
  const retentionAmount = amountFromAnswer(rawText, raw, "retention_amount");
  const total           = amountFromAnswer(rawText, raw, "total");
  // Empty when the receipt does not print it: the form applies the organization's currency.
  const currency        = normalize(raw.currency).toUpperCase();
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
