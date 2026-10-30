// AP invoice / purchase-order extraction on top of the provider layer.
//
// One primary model reads the document under an enforced JSON schema. A second
// model is consulted only on evidence that the first result is wrong: no lines,
// header totals that do not add up, key header fields missing, or the model
// itself flagging those fields as doubtful. No sampling, no line-count rules.

import { generateJson, isKnownModel, type AiJsonRequest, type AiUsage, type JsonSchema } from "@/lib/ai/provider";
import { validateExtraction, type ExtractionValidationConfig } from "./validation";
import type { BBox, ExtractedInvoice, ExtractedLine, ExtractionResult, UncertainField } from "./types";

export const DEFAULT_PRIMARY_MODEL   = "claude-haiku-5-5";
export const DEFAULT_SECONDARY_MODEL = "claude-sonnet-5-5";

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

function toBbox(value: unknown): BBox | null {
  if (!value || typeof value !== "object") return null;
  const b = value as Record<string, unknown>;
  const page = Math.max(1, Math.round(Number(b.page) || 1));
  const rX1 = Number(b.x1), rY1 = Number(b.y1);
  const rX2 = Number(b.x2), rY2 = Number(b.y2);
  if (!Number.isFinite(rX1) || !Number.isFinite(rY1) || !Number.isFinite(rX2) || !Number.isFinite(rY2)) return null;
  // Some models return 0-1000 instead of 0-1
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
  const itemCode = normalize(row.supplier_item_code ?? row.item_code ?? row.itemCode) || null;
  const description = normalize(row.description) || itemCode || "";
  if (!description) return null;
  const lineType = row.line_type === "charge" ? "charge" : "item";
  return {
    description,
    lineType,
    quantity: toNumber(row.quantity),
    rate:     toNumber(row.rate),
    amount:   toNumber(row.amount),
    uom:      normalize(row.uom) || null,
    itemCode,
    otherItemCode: normalize(row.other_item_code) || null,
    billedWeight:  toNumber(row.billed_weight),
    weightUom:     normalize(row.weight_uom) || null,
    bbox:     toBbox(row.bbox) ?? undefined,
  };
}

function detectFormat(text: string, vendor: string): ExtractedInvoice["format"] {
  const hay = (vendor + " " + text).toLowerCase();
  if (hay.includes("baldor")) return "baldor";
  if (hay.includes("performance foodservice") || hay.includes("performance")) return "performance";
  return "general";
}

const HEADER_FIELDS = new Set(["vendor", "vendor_tax_id", "invoice_number", "invoice_date", "delivery_date", "due_date", "purchase_order", "currency", "subtotal", "tax", "total"]);

function mapUncertain(value: unknown): UncertainField[] {
  if (!Array.isArray(value)) return [];
  const out: UncertainField[] = [];
  for (const entry of value.slice(0, 20)) {
    const row = (entry || {}) as Record<string, unknown>;
    const field = normalize(row.field);
    if (!field) continue;
    out.push({ field, reason: normalize(row.reason).slice(0, 200) || "sin motivo", header: HEADER_FIELDS.has(field) });
  }
  return out;
}

export function mapInvoice(parsed: Record<string, unknown>, sourceText: string): ExtractedInvoice {
  const linesRaw = Array.isArray(parsed?.lines) ? parsed.lines : [];
  const lines = linesRaw
    .map((row) => mapLine(row))
    .filter((l): l is ExtractedLine => l !== null);
  const vendor = normalize(parsed?.vendor);
  const uncertainFields = mapUncertain(parsed?.uncertain_fields);
  const issueDate = toDDMMYYYY(parsed?.invoice_date || parsed?.invoiceDate);
  const deliveryDate = toDDMMYYYY(parsed?.delivery_date);
  // Delivery-dated invoices (food service, freight) carry no separate issue
  // date; the delivery date is what accounting posts, flagged so a reviewer sees it.
  if (!issueDate && deliveryDate && !uncertainFields.some((f) => f.field === "invoice_date")) {
    uncertainFields.unshift({ field: "invoice_date", reason: "tomada de la fecha de entrega", header: true });
  }

  return {
    format:        detectFormat(sourceText, vendor),
    vendor,
    vendorRfc:     normalize(parsed?.vendor_tax_id) || undefined,
    invoiceNumber: normalize(parsed?.invoice_number || parsed?.invoiceNumber),
    invoiceDate:   issueDate || deliveryDate,
    deliveryDate,
    dueDate:       toDDMMYYYY(parsed?.due_date || parsed?.dueDate),
    purchaseOrder: normalize(parsed?.purchase_order || parsed?.purchaseOrder),
    currency:      normalize(parsed?.currency || "USD").toUpperCase() || "USD",
    subtotal:      toNumber(parsed?.subtotal),
    tax:           toNumber(parsed?.tax),
    total:         toNumber(parsed?.total),
    lines,
    uncertainFields,
  };
}

// ── Prompt and schema ─────────────────────────────────────────────────
// Claude's structured outputs cap union-typed (nullable) properties at 16 per
// schema, so strings use "" for "not printed" and only dates and numbers are
// nullable.
const nullable = (type: string, description?: string): JsonSchema => ({ type: [type, "null"], ...(description ? { description } : {}) });
const text = (description: string): JsonSchema => ({ type: "string", description: `${description} Empty string if not printed.` });

export const INVOICE_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["vendor", "vendor_tax_id", "invoice_number", "invoice_date", "delivery_date", "due_date", "purchase_order", "currency", "subtotal", "tax", "total", "lines", "uncertain_fields"],
  properties: {
    vendor:         text("Supplier (seller) legal or trade name only; never the buyer, never an address."),
    vendor_tax_id:  text("Supplier tax id (RFC, NIT, RUT, VAT, EIN)."),
    invoice_number: text("Invoice or order number as printed."),
    invoice_date:   nullable("string", "Date the document was issued, YYYY-MM-DD. null if not printed."),
    delivery_date:  nullable("string", "Delivery or service date, YYYY-MM-DD. null if not printed."),
    due_date:       nullable("string", "Payment due date, YYYY-MM-DD. null if not printed."),
    purchase_order: text("Buyer's purchase order reference as printed."),
    currency:       text("ISO 4217 code, e.g. USD, MXN."),
    subtotal:       nullable("number"),
    tax:            nullable("number", "Total taxes charged (VAT/IVA/sales tax)."),
    total:          nullable("number", "Amount payable."),
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["line_type", "description", "supplier_item_code", "other_item_code", "quantity", "uom", "billed_weight", "weight_uom", "rate", "amount", "bbox"],
        properties: {
          line_type:          { type: "string", enum: ["item", "charge"], description: "item = product or service sold; charge = surcharge, fee, freight, deposit or discount line." },
          description:        { type: "string" },
          supplier_item_code: text("The supplier's own item/SKU code from the item code column."),
          other_item_code:    text("Any other code printed for the line (manufacturer, customer or UPC code)."),
          quantity:           nullable("number", "Quantity in the unit that is priced."),
          uom:                text("Unit of the quantity (CS, EA, LB, KG, BX, pack/size text)."),
          billed_weight:      nullable("number", "For weight-priced lines, the weight the amount was computed on."),
          weight_uom:         text("Unit of billed_weight."),
          rate:               nullable("number", "Unit price in the priced unit."),
          amount:             nullable("number", "Extended line amount as printed."),
          bbox: {
            type: ["object", "null"],
            additionalProperties: false,
            required: ["page", "x1", "y1", "x2", "y2"],
            properties: { page: { type: "integer" }, x1: { type: "number" }, y1: { type: "number" }, x2: { type: "number" }, y2: { type: "number" } },
          },
        },
      },
    },
    uncertain_fields: {
      type: "array",
      description: "Fields you could not read with confidence, with the reason.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["field", "reason"],
        properties: { field: { type: "string" }, reason: { type: "string" } },
      },
    },
  },
};

/** Stable task description; it is cached by the provider, so it must not contain anything per document. */
export function getInstruction(): string {
  return [
    "You extract accounts-payable data from supplier invoices, order confirmations and purchase orders (any language, digital or scanned).",
    "Return only the JSON object described by the schema. Never invent values: a text field that is not printed is an empty string; a number or date that is not printed is null.",
    "Header rules:",
    "- vendor is the seller. The buyer, ship-to and bill-to parties are never the vendor.",
    "- invoice_date is the issue date of the document. Delivery, order-submitted and due dates go in their own fields. Never derive a date from the file name or a reference code.",
    "- Dates are YYYY-MM-DD. If the year is missing, use the year printed elsewhere on the document; otherwise null.",
    "- total is the amount payable; subtotal and tax only when printed.",
    "Line rules:",
    "- Capture every line printed before the totals, in document order, including surcharges, freight, fees, deposits and discounts; mark those as line_type \"charge\".",
    "- supplier_item_code is the code in the supplier's own item/SKU column. Codes that belong to the manufacturer, the customer or a barcode go in other_item_code.",
    "- quantity and rate refer to the unit that is priced. When a line is priced by weight (price per LB/KG with a billed weight), put the billed weight in billed_weight with its unit, and set quantity to that weight so that quantity x rate equals amount.",
    "- amount is the extended amount as printed; do not recompute it. Group subtotals and running totals are not lines.",
    "- bbox is the visual box of the whole line on its page: page is 1-based; x1,y1 top-left and x2,y2 bottom-right, normalized 0.0-1.0 relative to the page.",
    "- Keep descriptions as printed, without the pack/size prefix when it is a separate column.",
    "uncertain_fields: list only values that are printed but you could not read clearly or could not place with confidence (faint scan, overlapping marks, ambiguous column), naming the field (for lines use \"lines[n].amount\") and why. A field that is simply not printed is not uncertain: leave it null or empty and do not list it.",
  ].join("\n");
}

// ── Fallback by evidence ──────────────────────────────────────────────
export interface FallbackPolicy {
  onZeroLines?: boolean;
  onTotalMismatch?: boolean;
  onMissingHeader?: boolean;
  onModelDoubt?: boolean;
}

const DEFAULT_POLICY: Required<FallbackPolicy> = { onZeroLines: true, onTotalMismatch: true, onMissingHeader: true, onModelDoubt: true };

/** Why a second model should look at this document; null when the first result holds up. */
export function secondaryReason(invoice: ExtractedInvoice, validation: ExtractionValidationConfig = {}, policy: FallbackPolicy = {}): string | null {
  const p = { ...DEFAULT_POLICY, ...policy };
  if (p.onZeroLines && invoice.lines.length === 0) return "sin líneas";
  if (p.onTotalMismatch) {
    const v = validateExtraction(invoice, validation);
    if (v.level === "error") return `las líneas no cuadran con el total (diferencia ${v.difference.toFixed(2)})`;
  }
  if (p.onMissingHeader && !invoice.invoiceNumber && invoice.total === null) return "sin número ni total";
  if (p.onMissingHeader && !invoice.vendor) return "sin proveedor";
  if (p.onModelDoubt) {
    const doubted = invoice.uncertainFields.filter((f) => ["total", "invoice_number", "vendor"].includes(f.field));
    if (doubted.length > 0) return `el modelo duda de ${doubted.map((f) => f.field).join(", ")}`;
  }
  return null;
}

/** Prefer the second result only when it resolves what triggered it. */
function better(primary: ExtractedInvoice, secondary: ExtractedInvoice, validation: ExtractionValidationConfig, policy: FallbackPolicy): boolean {
  const primaryReason = secondaryReason(primary, validation, policy);
  const secondaryIssue = secondaryReason(secondary, validation, policy);
  if (secondaryIssue === null) return true;
  if (primaryReason === "sin líneas" && secondary.lines.length > 0) return true;
  return false;
}

// ── Entry point ───────────────────────────────────────────────────────
export type ExtractOptions = {
  fallbackEnabled?: boolean;        // ai_tiered_fallback
  forceSecondary?:  boolean;        // ai_force_secondary
  apiKey?:          string;         // per-org Gemini key
  primaryModel?:    string;         // ai_model_selection
  secondaryModel?:  string;         // ai_model_selection
  maxChars?:        number;         // ai_model_selection (approximate AI output limit)
  policy?:          FallbackPolicy; // ai_tiered_fallback
  validation?:      ExtractionValidationConfig; // ai_validation_thresholds, used to judge the first result
  timeoutMs?:       number;
  effort?:          "low" | "medium" | "high"; // ai_model_selection (Claude only)
};

export function configuredEffort(value: unknown): "low" | "medium" | "high" | undefined {
  return value === "low" || value === "medium" || value === "high" ? value : undefined;
}

export function configuredModel(value: unknown, fallback: string): string {
  return isKnownModel(value) ? value : fallback;
}

function outputTokenLimit(maxChars: unknown): number {
  const characters = Number(maxChars);
  if (!Number.isFinite(characters)) return 8000;
  // Four characters per token is the usual conservative conversion for the JSON response.
  return Math.max(1024, Math.min(16000, Math.round(characters / 4)));
}

async function callModel(model: string, fileName: string, mimeType: string, base64: string, options: ExtractOptions): Promise<{ invoice: ExtractedInvoice; rawJson: string; usage: AiUsage }> {
  const req: AiJsonRequest = {
    model,
    instruction: getInstruction(),
    parts: [{ kind: "file", base64, mimeType }],
    note: `FILE_NAME: ${normalize(fileName) || "invoice"}`,
    schema: INVOICE_SCHEMA,
    apiKey: options.apiKey,
    maxOutputTokens: outputTokenLimit(options.maxChars),
    timeoutMs: options.timeoutMs,
    effort: options.effort,
  };
  const res = await generateJson(req);
  return { invoice: mapInvoice(res.json, normalize(fileName)), rawJson: res.rawText, usage: res.usage };
}

export async function extractFromFile(params: {
  fileName:      string;
  mimeType:      string;
  base64Content: string;
  options?:      ExtractOptions;
}): Promise<ExtractionResult> {
  const options = params.options ?? {};
  const { fallbackEnabled = true, forceSecondary = false } = options;
  const primaryModel = configuredModel(options.primaryModel, DEFAULT_PRIMARY_MODEL);
  const secondaryModel = configuredModel(options.secondaryModel, DEFAULT_SECONDARY_MODEL);
  const validation = options.validation ?? {};
  const policy = options.policy ?? {};

  if (forceSecondary) {
    const r = await callModel(secondaryModel, params.fileName, params.mimeType, params.base64Content, options);
    return { invoice: r.invoice, model: secondaryModel, fallbackUsed: true, fallbackReason: "forzado por configuración", rawJson: r.rawJson, promptTokens: r.usage.inputTokens, completionTokens: r.usage.outputTokens, cachedTokens: r.usage.cachedInputTokens };
  }

  const first = await callModel(primaryModel, params.fileName, params.mimeType, params.base64Content, options);
  const reason = secondaryReason(first.invoice, validation, policy);
  const primaryResult: ExtractionResult = { invoice: first.invoice, model: primaryModel, fallbackUsed: false, fallbackReason: null, rawJson: first.rawJson, promptTokens: first.usage.inputTokens, completionTokens: first.usage.outputTokens, cachedTokens: first.usage.cachedInputTokens };
  if (!reason || !fallbackEnabled || secondaryModel === primaryModel) return primaryResult;

  console.warn(`[extract] ${primaryModel} → ${secondaryModel}: ${reason}`);
  let second: Awaited<ReturnType<typeof callModel>>;
  try {
    second = await callModel(secondaryModel, params.fileName, params.mimeType, params.base64Content, options);
  } catch (error) {
    // The first result still stands; the pipeline's own validation decides its fate.
    console.warn("[extract] secondary model failed, keeping primary:", error instanceof Error ? error.message : error);
    return primaryResult;
  }
  if (!better(first.invoice, second.invoice, validation, policy)) return primaryResult;
  return {
    invoice: second.invoice, model: secondaryModel, fallbackUsed: true, fallbackReason: reason, rawJson: second.rawJson,
    promptTokens: first.usage.inputTokens + second.usage.inputTokens,
    completionTokens: first.usage.outputTokens + second.usage.outputTokens,
    cachedTokens: first.usage.cachedInputTokens + second.usage.cachedInputTokens,
  };
}

/** Builds the request a batch would submit for this document (same prompt, schema and limits as a direct call). */
export function extractionRequest(model: string, fileName: string, mimeType: string, base64: string, options: ExtractOptions = {}): AiJsonRequest {
  return {
    model, instruction: getInstruction(), parts: [{ kind: "file", base64, mimeType }], note: `FILE_NAME: ${normalize(fileName) || "invoice"}`,
    schema: INVOICE_SCHEMA, apiKey: options.apiKey, maxOutputTokens: outputTokenLimit(options.maxChars), effort: options.effort,
  };
}
