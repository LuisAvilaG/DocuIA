import type { BBox, ExtractedInvoice, ExtractedLine, ExtractionResult } from "./types";

const FLASH_MODEL = "gemini-2.5-flash";
const PRO_MODEL   = "gemini-2.5-pro";
const MAX_CHARS   = 65000;

function normalize(value: unknown): string {
  return String(value ?? "")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const clean = String(value)
    .replace(/[$,\s]/g, "")
    .replace(/[^\d.\-]/g, "")
    .trim();
  if (!clean) return null;
  const n = Number(clean);
  return Number.isFinite(n) ? n : null;
}

function toDDMMYYYY(value: unknown): string {
  const input = normalize(value);
  if (!input) return "";

  const iso = input.match(/^(\d{4})[-/](\d{2})[-/](\d{2})$/);
  if (iso) return `${iso[3]}.${iso[2]}.${iso[1]}`;

  const dot = input.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (dot) return input;

  const slash = input.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    const year = slash[3];
    if (a <= 12 && b > 12) return `${String(b).padStart(2, "0")}.${String(a).padStart(2, "0")}.${year}`;
    return `${String(a).padStart(2, "0")}.${String(b).padStart(2, "0")}.${year}`;
  }

  return input;
}

function parseJsonObject(text: string): Record<string, unknown> {
  const raw = String(text || "").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("AI response has no valid JSON object");
    return JSON.parse(match[0]);
  }
}

function toBbox(value: unknown): BBox | null {
  if (!value || typeof value !== "object") return null;
  const b = value as Record<string, unknown>;
  const page = Math.max(1, Math.round(Number(b.page) || 1));
  const rX1 = Number(b.x1), rY1 = Number(b.y1);
  const rX2 = Number(b.x2), rY2 = Number(b.y2);
  if (!Number.isFinite(rX1) || !Number.isFinite(rY1) || !Number.isFinite(rX2) || !Number.isFinite(rY2)) return null;
  // Gemini sometimes returns 0-1000 instead of 0-1
  const maxVal = Math.max(rX1, rY1, rX2, rY2);
  const s = maxVal > 1.5 ? 1000 : 1;
  const x1 = Math.max(0, Math.min(1, rX1 / s));
  const y1 = Math.max(0, Math.min(1, rY1 / s));
  const x2 = Math.max(0, Math.min(1, rX2 / s));
  const y2 = Math.max(0, Math.min(1, rY2 / s));
  if (x1 >= x2 || y1 >= y2) return null;
  return { page, x1, y1, x2, y2 };
}

function mapLine(line: unknown): ExtractedLine | null {
  const row = (line || {}) as Record<string, unknown>;
  const description = normalize(row.description || row.item_code || row.itemCode);
  if (!description) return null;
  return {
    description,
    quantity: toNumber(row.quantity),
    rate:     toNumber(row.rate),
    amount:   toNumber(row.amount),
    uom:      normalize(row.uom) || null,
    itemCode: normalize(row.item_code || row.itemCode) || null,
    bbox:     toBbox(row.bbox) ?? undefined,
  };
}

function detectFormat(text: string, vendor: string): ExtractedInvoice["format"] {
  const hay = (vendor + " " + text).toLowerCase();
  if (hay.includes("baldor")) return "baldor";
  if (hay.includes("performance foodservice") || hay.includes("performance")) return "performance";
  return "general";
}

function mapInvoice(parsed: Record<string, unknown>, sourceText: string): ExtractedInvoice {
  const linesRaw = Array.isArray(parsed?.lines) ? parsed.lines : [];
  const lines = linesRaw
    .map((row) => mapLine(row))
    .filter((l): l is ExtractedLine => l !== null);
  const vendor = normalize(parsed?.vendor);

  return {
    format:        detectFormat(sourceText, vendor),
    vendor,
    invoiceNumber: normalize(parsed?.invoice_number || parsed?.invoiceNumber),
    invoiceDate:   toDDMMYYYY(parsed?.invoice_date || parsed?.invoiceDate),
    dueDate:       toDDMMYYYY(parsed?.due_date || parsed?.dueDate),
    purchaseOrder: normalize(parsed?.purchase_order || parsed?.purchaseOrder),
    currency:      normalize(parsed?.currency || "USD").toUpperCase() || "USD",
    subtotal:      toNumber(parsed?.subtotal),
    tax:           toNumber(parsed?.tax),
    total:         toNumber(parsed?.total),
    lines,
  };
}

function getApiKey(override?: string): string {
  const key = normalize(override || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY);
  if (!key) throw new Error("Missing GOOGLE_API_KEY — configure it in .env.local or in the client's AI config");
  return key;
}

function getInstruction(): string {
  return [
    "Extract invoice fields from the provided content.",
    "Return ONLY a strict JSON object.",
    "Do not include markdown, comments, or explanations.",
    "Do not invent values — use null or empty string if unknown.",
    "Vendor must be supplier name only, never address or contact text.",
    "Capture all line items present before subtotal/tax/total.",
    "For each line include bbox: the visual bounding box of that line in the document (page is 1-indexed; x1,y1 are the top-left corner; x2,y2 are the bottom-right corner; all coordinates normalized 0.0-1.0).",
    "Schema:",
    JSON.stringify({
      vendor:         "string",
      invoice_number: "string",
      invoice_date:   "string",
      due_date:       "string",
      purchase_order: "string",
      currency:       "string",
      subtotal:       "number|null",
      tax:            "number|null",
      total:          "number|null",
      lines: [{
        description: "string",
        item_code:   "string|null",
        quantity:    "number|null",
        rate:        "number|null",
        amount:      "number|null",
        uom:         "string|null",
        bbox:        { page: 1, x1: 0.0, y1: 0.0, x2: 1.0, y2: 1.0 },
      }],
    }),
  ].join(" ");
}

type GeminiPart = Record<string, unknown>;

async function callModel(model: string, parts: GeminiPart[], apiKeyOverride?: string): Promise<{
  text: string;
  promptTokens: number;
  completionTokens: number;
}> {
  const apiKey = getApiKey(apiKeyOverride);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents:         [{ role: "user", parts }],
      generationConfig: { temperature: 0, responseMimeType: "application/json" },
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`AI extraction failed (${response.status}): ${body}`);
  }

  const json = await response.json() as Record<string, unknown>;
  const candidates = Array.isArray(json?.candidates) ? json.candidates : [];
  let text = "";
  for (const candidate of candidates) {
    const parts2 = Array.isArray((candidate as any)?.content?.parts) ? (candidate as any).content.parts : [];
    for (const part of parts2) {
      const t = normalize((part as any)?.text);
      if (t) { text = t; break; }
    }
    if (text) break;
  }
  if (!text) throw new Error("AI extraction returned empty content");

  const usage = (json as any)?.usageMetadata;
  return {
    text,
    promptTokens:     Number(usage?.promptTokenCount    || 0),
    completionTokens: Number(usage?.candidatesTokenCount || 0),
  };
}

export type ExtractOptions = {
  fallbackEnabled?: boolean; // ai_tiered_fallback — default true
  forceSecondary?:  boolean; // ai_force_secondary  — default false
  apiKey?:          string;  // per-org override; falls back to GOOGLE_API_KEY env
};

export async function extractFromFile(params: {
  fileName:      string;
  mimeType:      string;
  base64Content: string;
  options?:      ExtractOptions;
}): Promise<ExtractionResult> {
  const { fallbackEnabled = true, forceSecondary = false, apiKey } = params.options ?? {};

  const instruction = getInstruction();
  const parts: GeminiPart[] = [
    { text: `${instruction} FILE_NAME: ${normalize(params.fileName) || "invoice"}` },
    { inline_data: { mime_type: params.mimeType, data: params.base64Content } },
  ];

  // ai_force_secondary: skip primary model entirely
  if (forceSecondary) {
    const result = await callModel(PRO_MODEL, parts, apiKey);
    const parsed  = parseJsonObject(result.text);
    const invoice = mapInvoice(parsed, normalize(params.fileName));
    return {
      invoice,
      model:            PRO_MODEL,
      fallbackUsed:     true,
      rawJson:          result.text,
      promptTokens:     result.promptTokens,
      completionTokens: result.completionTokens,
    };
  }

  // Primary model attempt
  try {
    const result = await callModel(FLASH_MODEL, parts, apiKey);
    const parsed  = parseJsonObject(result.text);
    const invoice = mapInvoice(parsed, normalize(params.fileName));
    if (invoice.lines.length === 0) throw new Error("Primary model returned zero lines");
    return {
      invoice,
      model:            FLASH_MODEL,
      fallbackUsed:     false,
      rawJson:          result.text,
      promptTokens:     result.promptTokens,
      completionTokens: result.completionTokens,
    };
  } catch (primaryErr) {
    // ai_tiered_fallback disabled: propagate the error, no retry
    if (!fallbackEnabled) {
      throw primaryErr;
    }
    console.warn("[extract] Primary failed, using secondary:", (primaryErr as Error).message);
    const result = await callModel(PRO_MODEL, parts, apiKey);
    const parsed  = parseJsonObject(result.text);
    const invoice = mapInvoice(parsed, normalize(params.fileName));
    return {
      invoice,
      model:            PRO_MODEL,
      fallbackUsed:     true,
      rawJson:          result.text,
      promptTokens:     result.promptTokens,
      completionTokens: result.completionTokens,
    };
  }
}

export async function extractFromText(params: {
  ocrText: string;
  model?:  string;
  options?: ExtractOptions;
}): Promise<ExtractionResult> {
  const { fallbackEnabled = true, forceSecondary = false, apiKey } = params.options ?? {};
  const maxChars = Math.max(5000, Math.min(MAX_CHARS, 200000));
  const text = params.ocrText.slice(0, maxChars);
  const instruction = getInstruction();
  const parts: GeminiPart[] = [{ text: `${instruction} OCR_TEXT:\n${text}` }];

  const startModel = forceSecondary ? PRO_MODEL : (params.model || FLASH_MODEL);

  try {
    const result = await callModel(startModel, parts, apiKey);
    const parsed  = parseJsonObject(result.text);
    const invoice = mapInvoice(parsed, text);
    if (invoice.lines.length === 0 && !params.model && !forceSecondary) {
      throw new Error("Primary model returned zero lines");
    }
    return {
      invoice,
      model:            startModel,
      fallbackUsed:     forceSecondary,
      rawJson:          result.text,
      promptTokens:     result.promptTokens,
      completionTokens: result.completionTokens,
    };
  } catch (err) {
    if (params.model || forceSecondary || !fallbackEnabled) throw err;
    console.warn("[extract] Primary OCR failed, using secondary:", (err as Error).message);
    const result = await callModel(PRO_MODEL, parts, apiKey);
    const parsed  = parseJsonObject(result.text);
    const invoice = mapInvoice(parsed, text);
    return {
      invoice,
      model:            PRO_MODEL,
      fallbackUsed:     true,
      rawJson:          result.text,
      promptTokens:     result.promptTokens,
      completionTokens: result.completionTokens,
    };
  }
}
