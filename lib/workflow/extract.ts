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
    "Dates (invoice_date, due_date) MUST be returned in ISO format YYYY-MM-DD. Never use DD/MM/YYYY or MM/DD/YYYY.",
    "Capture all line items present before subtotal/tax/total.",
    "For each line include bbox: the visual bounding box of that line in the document (page is 1-indexed; x1,y1 are the top-left corner; x2,y2 are the bottom-right corner; all coordinates normalized 0.0-1.0).",
    "Schema:",
    JSON.stringify({
      vendor:         "string",
      invoice_number: "string",
      invoice_date:   "YYYY-MM-DD",
      due_date:       "YYYY-MM-DD",
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Transient Gemini errors worth retrying: rate limits and upstream hiccups.
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const GEMINI_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS) || 90_000;

export type TieredFallbackConfig = {
  softFallbackRate?: unknown;
  canaryRate?: unknown;
  stickySecondaryEnabled?: unknown;
  allowSecondaryForBaldor?: unknown;
  complexLineCountThreshold?: unknown;
  primaryMaxRetries?: unknown;
  secondaryMaxRetries?: unknown;
  retryBaseMs?: unknown;
  retryMaxMs?: unknown;
};

type ResolvedTieredFallbackConfig = {
  softFallbackRate: number;
  canaryRate: number;
  stickySecondaryEnabled: boolean;
  allowSecondaryForBaldor: boolean;
  complexLineCountThreshold: number;
  primaryMaxRetries: number;
  secondaryMaxRetries: number;
  retryBaseMs: number;
  retryMaxMs: number;
};

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function resolveTieredFallbackConfig(config?: TieredFallbackConfig): ResolvedTieredFallbackConfig {
  return {
    softFallbackRate: boundedNumber(config?.softFallbackRate, 0.08, 0, 1),
    canaryRate: boundedNumber(config?.canaryRate, 0, 0, 0.5),
    stickySecondaryEnabled: config?.stickySecondaryEnabled !== false,
    allowSecondaryForBaldor: config?.allowSecondaryForBaldor === true,
    complexLineCountThreshold: Math.round(boundedNumber(config?.complexLineCountThreshold, 12, 3, 200)),
    primaryMaxRetries: Math.round(boundedNumber(config?.primaryMaxRetries, 3, 0, 5)),
    secondaryMaxRetries: Math.round(boundedNumber(config?.secondaryMaxRetries, 1, 0, 3)),
    retryBaseMs: Math.round(boundedNumber(config?.retryBaseMs, 1500, 250, 10000)),
    retryMaxMs: Math.round(boundedNumber(config?.retryMaxMs, 8000, 1000, 60000)),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function outputTokenLimit(maxChars: unknown): number | undefined {
  const characters = Number(maxChars);
  if (!Number.isFinite(characters)) return undefined;
  // Gemini controls output in tokens; four characters per token is the usual
  // conservative conversion for the JSON extraction response.
  return Math.max(256, Math.min(8192, Math.round(characters / 4)));
}

async function callModel(
  model: string,
  parts: GeminiPart[],
  apiKeyOverride?: string,
  maxChars?: number,
  retry?: Pick<ResolvedTieredFallbackConfig, "retryBaseMs" | "retryMaxMs"> & { maxRetries: number },
): Promise<{
  text: string;
  promptTokens: number;
  completionTokens: number;
}> {
  const apiKey = getApiKey(apiKeyOverride);
  const maxOutputTokens = outputTokenLimit(maxChars);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const maxRetries = retry?.maxRetries ?? 3;
  const attempts = maxRetries + 1;
  const retryBaseMs = retry?.retryBaseMs ?? 1500;
  const retryMaxMs = retry?.retryMaxMs ?? 8000;
  let response: Response | null = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) {
      const backoff = Math.min(retryMaxMs, retryBaseMs * 2 ** (attempt - 1)) + Math.floor(Math.random() * Math.min(300, retryBaseMs / 4));
      await sleep(backoff);
    }
    try {
      response = await fetch(url, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents:         [{ role: "user", parts }],
          generationConfig: {
            temperature: 0,
            responseMimeType: "application/json",
            ...(maxOutputTokens ? { maxOutputTokens } : {}),
          },
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
      });
    } catch (e) {
      // Network error or timeout (AbortError). Retry unless attempts exhausted.
      if (attempt === attempts - 1) {
        const reason = e instanceof Error ? e.message : String(e);
        throw new Error(`AI extraction request failed (network/timeout): ${reason}`);
      }
      continue;
    }
    if (response.ok) break;
    if (!RETRYABLE_STATUS.has(response.status) || attempt === attempts - 1) {
      const body = await response.text();
      throw new Error(`AI extraction failed (${response.status}): ${body}`);
    }
    // retryable status → loop and back off
  }

  const json = await response!.json() as Record<string, unknown>;
  const candidates = Array.isArray(json?.candidates) ? json.candidates : [];
  let text = "";
  for (const candidate of candidates) {
    const content = isRecord(candidate) && isRecord(candidate.content) ? candidate.content : null;
    const parts2 = content && Array.isArray(content.parts) ? content.parts : [];
    for (const part of parts2) {
      const t = normalize(isRecord(part) ? part.text : "");
      if (t) { text = t; break; }
    }
    if (text) break;
  }
  if (!text) throw new Error("AI extraction returned empty content");

  const usage = isRecord(json.usageMetadata) ? json.usageMetadata : {};
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
  primaryModel?:     string; // ai_model_selection
  secondaryModel?:   string; // ai_model_selection
  maxChars?:         number; // ai_model_selection (OCR input / approximate AI output limit)
  tieredFallback?:   TieredFallbackConfig;
};

function allowsSecondary(source: string, config: ResolvedTieredFallbackConfig): boolean {
  return config.allowSecondaryForBaldor || !source.toLowerCase().includes("baldor");
}

function isSoftExtractionFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("zero lines") || message.includes("empty content") || message.includes("valid JSON");
}

function retryConfig(config: ResolvedTieredFallbackConfig, secondary: boolean) {
  return {
    maxRetries: secondary ? config.secondaryMaxRetries : config.primaryMaxRetries,
    retryBaseMs: config.retryBaseMs,
    retryMaxMs: config.retryMaxMs,
  };
}

function configuredModel(value: unknown, fallback: string): string {
  const model = normalize(value);
  // Keep the configurable value constrained to Gemini model identifiers.
  return /^gemini-[a-z0-9.-]+$/i.test(model) ? model : fallback;
}

export async function extractFromFile(params: {
  fileName:      string;
  mimeType:      string;
  base64Content: string;
  options?:      ExtractOptions;
}): Promise<ExtractionResult> {
  const { fallbackEnabled = true, forceSecondary = false, apiKey } = params.options ?? {};
  const tiered = resolveTieredFallbackConfig(params.options?.tieredFallback);
  const primaryModel = configuredModel(params.options?.primaryModel, FLASH_MODEL);
  const secondaryModel = configuredModel(params.options?.secondaryModel, PRO_MODEL);

  const instruction = getInstruction();
  const parts: GeminiPart[] = [
    { text: `${instruction} FILE_NAME: ${normalize(params.fileName) || "invoice"}` },
    { inline_data: { mime_type: params.mimeType, data: params.base64Content } },
  ];
  const secondaryAllowed = allowsSecondary(params.fileName, tiered);

  // ai_force_secondary: skip primary model entirely
  if (forceSecondary) {
    const result = await callModel(secondaryModel, parts, apiKey, params.options?.maxChars, retryConfig(tiered, true));
    const parsed  = parseJsonObject(result.text);
    const invoice = mapInvoice(parsed, normalize(params.fileName));
    return {
      invoice,
      model:            secondaryModel,
      fallbackUsed:     true,
      rawJson:          result.text,
      promptTokens:     result.promptTokens,
      completionTokens: result.completionTokens,
    };
  }

  // Primary model attempt
  try {
    const result = await callModel(primaryModel, parts, apiKey, params.options?.maxChars, retryConfig(tiered, false));
    const parsed  = parseJsonObject(result.text);
    const invoice = mapInvoice(parsed, normalize(params.fileName));
    if (invoice.lines.length === 0) throw new Error("Primary model returned zero lines");

    // Complex documents intentionally receive a Pro extraction as the final
    // result. Canary calls exercise Pro without replacing a valid Flash result.
    if (secondaryAllowed && invoice.lines.length >= tiered.complexLineCountThreshold) {
      try {
        const secondary = await callModel(secondaryModel, parts, apiKey, params.options?.maxChars, retryConfig(tiered, true));
        const secondaryInvoice = mapInvoice(parseJsonObject(secondary.text), normalize(params.fileName));
        if (secondaryInvoice.lines.length === 0) throw new Error("Secondary model returned zero lines");
        return {
          invoice: secondaryInvoice, model: secondaryModel, fallbackUsed: true, rawJson: secondary.text,
          promptTokens: secondary.promptTokens, completionTokens: secondary.completionTokens,
        };
      } catch (secondaryError) {
        if (tiered.stickySecondaryEnabled) {
          const message = secondaryError instanceof Error ? secondaryError.message : String(secondaryError);
          throw new Error(`Secondary model failed for complex document: ${message}`);
        }
      }
    } else if (secondaryAllowed && Math.random() < tiered.canaryRate) {
      void callModel(secondaryModel, parts, apiKey, params.options?.maxChars, retryConfig(tiered, true)).catch(() => {});
    }
    return {
      invoice,
      model:            primaryModel,
      fallbackUsed:     false,
      rawJson:          result.text,
      promptTokens:     result.promptTokens,
      completionTokens: result.completionTokens,
    };
  } catch (primaryErr) {
    // Soft extraction failures are sampled; transport/provider failures always
    // fall through to Pro. Baldor is explicitly opt-in for Pro usage.
    const message = primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
    if (message.startsWith("Secondary model failed for complex document:")
      || !fallbackEnabled || !secondaryAllowed
      || (isSoftExtractionFailure(primaryErr) && Math.random() >= tiered.softFallbackRate)) {
      throw primaryErr;
    }
    console.warn("[extract] Primary failed, using secondary:", (primaryErr as Error).message);
    const result = await callModel(secondaryModel, parts, apiKey, params.options?.maxChars, retryConfig(tiered, true));
    const parsed  = parseJsonObject(result.text);
    const invoice = mapInvoice(parsed, normalize(params.fileName));
    return {
      invoice,
      model:            secondaryModel,
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
  const tiered = resolveTieredFallbackConfig(params.options?.tieredFallback);
  const primaryModel = configuredModel(params.options?.primaryModel, FLASH_MODEL);
  const secondaryModel = configuredModel(params.options?.secondaryModel, PRO_MODEL);
  const configuredMaxChars = Number(params.options?.maxChars);
  const maxChars = Number.isFinite(configuredMaxChars)
    ? Math.max(5000, Math.min(configuredMaxChars, 200000))
    : MAX_CHARS;
  const text = params.ocrText.slice(0, maxChars);
  const instruction = getInstruction();
  const parts: GeminiPart[] = [{ text: `${instruction} OCR_TEXT:\n${text}` }];
  const secondaryAllowed = allowsSecondary(text, tiered);

  const startModel = forceSecondary ? secondaryModel : (params.model || primaryModel);

  try {
    const result = await callModel(startModel, parts, apiKey, params.options?.maxChars, retryConfig(tiered, forceSecondary));
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
    if (params.model || forceSecondary || !fallbackEnabled || !secondaryAllowed || (isSoftExtractionFailure(err) && Math.random() >= tiered.softFallbackRate)) throw err;
    console.warn("[extract] Primary OCR failed, using secondary:", (err as Error).message);
    const result = await callModel(secondaryModel, parts, apiKey, params.options?.maxChars, retryConfig(tiered, true));
    const parsed  = parseJsonObject(result.text);
    const invoice = mapInvoice(parsed, text);
    return {
      invoice,
      model:            secondaryModel,
      fallbackUsed:     true,
      rawJson:          result.text,
      promptTokens:     result.promptTokens,
      completionTokens: result.completionTokens,
    };
  }
}
