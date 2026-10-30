// One door to the model providers for JSON-shaped document tasks. Callers
// describe the request (instruction + text/file parts, optionally a schema)
// and get parsed JSON plus token usage back; which API is hit depends only on
// the model id.
//
// Gemini keeps the raw REST call the rest of the codebase already used; Claude
// goes through the official SDK. Per-organization key overrides apply to Gemini
// only (that is what the admin "clave de IA propia" stores); Claude always uses
// the platform key.

import Anthropic from "@anthropic-ai/sdk";

export type AiProvider = "gemini" | "anthropic";

export type AiPart =
  | { kind: "text"; text: string }
  | { kind: "file"; base64: string; mimeType: string };

/** JSON Schema subset both providers accept: object/array/string/number/integer/boolean, nullable via ["string","null"], enum, required. */
export type JsonSchema = {
  type: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: Array<string | number>;
  additionalProperties?: boolean;
};

export interface AiJsonRequest {
  model: string;
  /**
   * Stable task description: what to extract and how. Sent as the system
   * prompt and cached, so repeated calls with the same instruction pay a
   * fraction for it. Keep anything per-document out of it.
   */
  instruction: string;
  parts: AiPart[];
  /** Per-document text that follows the parts (file name, page notes). */
  note?: string;
  /** When set, the provider enforces this shape on the response. */
  schema?: JsonSchema;
  /** Organization-specific Gemini key; ignored for Claude. */
  apiKey?: string;
  maxOutputTokens?: number;
  timeoutMs?: number;
  /** Reasoning depth on Claude (ignored by Gemini). Lower is faster; the model still reasons. */
  effort?: "low" | "medium" | "high";
}

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  /** Input tokens served from the prompt cache (already included in inputTokens). */
  cachedInputTokens: number;
}

export interface AiJsonResult {
  json: Record<string, unknown>;
  rawText: string;
  usage: AiUsage;
  model: string;
  provider: AiProvider;
}

export const AI_MODELS: Array<{ id: string; label: string; provider: AiProvider }> = [
  { id: "gemini-2.5-flash",  label: "Gemini 2.5 Flash",  provider: "gemini" },
  { id: "gemini-2.5-pro",    label: "Gemini 2.5 Pro",    provider: "gemini" },
  { id: "claude-haiku-5-5",  label: "Claude Haiku 5.5",  provider: "anthropic" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", provider: "anthropic" },
  { id: "claude-opus-5-5",   label: "Claude Opus 5.5",   provider: "anthropic" },
];
export const AI_MODEL_IDS = AI_MODELS.map((m) => m.id);

export function providerOf(model: string): AiProvider {
  return model.startsWith("claude") ? "anthropic" : "gemini";
}

export function isKnownModel(model: unknown): model is string {
  return typeof model === "string" && AI_MODEL_IDS.includes(model);
}

const DEFAULT_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) || Number(process.env.GEMINI_TIMEOUT_MS) || 90_000;
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 4;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Tolerant JSON reader: models occasionally wrap the object in fences or prose. */
export function parseJsonObject(text: string): Record<string, unknown> {
  const raw = String(text ?? "").trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  if (!raw) return {};
  try { return JSON.parse(raw) as Record<string, unknown>; }
  catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("La IA no devolvió JSON válido");
    return JSON.parse(m[0]) as Record<string, unknown>;
  }
}

// ── Gemini ────────────────────────────────────────────────────────────
function geminiKey(override?: string): string {
  const key = (override || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || "").trim();
  if (!key) throw new Error("Falta GOOGLE_API_KEY/GEMINI_API_KEY para usar Gemini");
  return key;
}

/** Gemini's response schema is an OpenAPI subset: upper-case types, `nullable` instead of a null type, no additionalProperties. */
export function toGeminiSchema(schema: JsonSchema): Record<string, unknown> {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const base = types.find((t) => t !== "null") ?? "string";
  const out: Record<string, unknown> = { type: base.toUpperCase() };
  if (types.includes("null")) out.nullable = true;
  if (schema.description) out.description = schema.description;
  if (schema.enum) out.enum = schema.enum.map(String);
  if (schema.properties) {
    out.properties = Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, toGeminiSchema(value)]));
    out.propertyOrdering = Object.keys(schema.properties);
  }
  if (schema.required) out.required = schema.required;
  if (schema.items) out.items = toGeminiSchema(schema.items);
  return out;
}

function geminiBody(req: AiJsonRequest): Record<string, unknown> {
  const parts = [
    ...req.parts.map((p) => p.kind === "text" ? { text: p.text } : { inline_data: { mime_type: p.mimeType, data: p.base64 } }),
    ...(req.note ? [{ text: req.note }] : []),
  ];
  if (parts.length === 0) parts.push({ text: "Documento adjunto." });
  return {
    systemInstruction: { parts: [{ text: req.instruction }] },
    contents: [{ role: "user", parts }],
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json",
      // Flash reasons at length over a response schema (4x the output tokens
      // for the same answer); extraction does not need it. Pro cannot turn it off.
      ...(req.model === "gemini-2.5-flash" ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
      ...(req.schema ? { responseSchema: toGeminiSchema(req.schema) } : {}),
      ...(req.maxOutputTokens ? { maxOutputTokens: req.maxOutputTokens } : {}),
    },
  };
}

async function geminiJson(req: AiJsonRequest): Promise<AiJsonResult> {
  const apiKey = geminiKey(req.apiKey);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(req.model)}:generateContent`;
  const body = JSON.stringify(geminiBody(req));
  let response: Response | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(Math.min(8000, 500 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 300));
    try {
      response = await fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey }, body,
        cache: "no-store", signal: AbortSignal.timeout(req.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch (e) {
      if (attempt === MAX_ATTEMPTS - 1) throw new Error(`Fallo de red/timeout con Gemini: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    if (response.ok) break;
    if (!RETRYABLE.has(response.status) || attempt === MAX_ATTEMPTS - 1) {
      throw new Error(`Gemini falló (${response.status}): ${(await response.text()).slice(0, 300)}`);
    }
  }
  const json = await response!.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; usageMetadata?: Record<string, number> };
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  const usage = json.usageMetadata ?? {};
  return {
    json: parseJsonObject(text), rawText: text,
    usage: {
      inputTokens: usage.promptTokenCount ?? 0,
      outputTokens: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
      cachedInputTokens: usage.cachedContentTokenCount ?? 0,
    },
    model: req.model, provider: "gemini",
  };
}

// ── Claude ────────────────────────────────────────────────────────────
let anthropicClient: Anthropic | null = null;
export function anthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("Falta ANTHROPIC_API_KEY para usar Claude");
  anthropicClient ??= new Anthropic({
    maxRetries: 3,
    // Organization-level keys must name the workspace to bill against.
    defaultHeaders: process.env.ANTHROPIC_WORKSPACE_ID ? { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID } : undefined,
  });
  return anthropicClient;
}

/** The Messages request for one JSON task; shared by direct calls and batches. */
export function claudeParams(req: AiJsonRequest): Anthropic.MessageCreateParamsNonStreaming {
  const content: Anthropic.ContentBlockParam[] = req.parts.map((p) => {
    if (p.kind === "text") return { type: "text", text: p.text };
    if (p.mimeType === "application/pdf") return { type: "document", source: { type: "base64", media_type: "application/pdf", data: p.base64 } };
    return { type: "image", source: { type: "base64", media_type: p.mimeType as "image/png" | "image/jpeg" | "image/webp" | "image/gif", data: p.base64 } };
  });
  // Documents first, then the per-document note: the model reads the material before the ask.
  content.push({ type: "text", text: `${req.note ? `${req.note}\n` : ""}Responde únicamente con el objeto JSON pedido, sin texto alrededor.` });
  return {
    model: req.model,
    max_tokens: req.maxOutputTokens ?? 8000,
    // The task description is identical across documents: cache it.
    system: [{ type: "text", text: req.instruction, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content }],
    ...(req.schema || req.effort ? {
      output_config: {
        ...(req.schema ? { format: { type: "json_schema" as const, schema: req.schema as unknown as Record<string, unknown> } } : {}),
        ...(req.effort ? { effort: req.effort } : {}),
      },
    } : {}),
  };
}

function claudeResult(res: Anthropic.Message, req: AiJsonRequest): AiJsonResult {
  if (res.stop_reason === "refusal") throw new Error(`Claude rechazó la solicitud${res.stop_details?.category ? ` (${res.stop_details.category})` : ""}`);
  if (res.stop_reason === "max_tokens") throw new Error("Claude no terminó la respuesta: aumenta maxOutputTokens");
  const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
  const cached = res.usage.cache_read_input_tokens ?? 0;
  const created = res.usage.cache_creation_input_tokens ?? 0;
  return {
    json: parseJsonObject(text), rawText: text,
    usage: { inputTokens: res.usage.input_tokens + cached + created, outputTokens: res.usage.output_tokens, cachedInputTokens: cached },
    model: req.model, provider: "anthropic",
  };
}

async function claudeJson(req: AiJsonRequest): Promise<AiJsonResult> {
  const res = await anthropic().messages.create(claudeParams(req), { timeout: req.timeoutMs ?? Math.max(DEFAULT_TIMEOUT_MS, 120_000) });
  return claudeResult(res, req);
}

export async function generateJson(req: AiJsonRequest): Promise<AiJsonResult> {
  return providerOf(req.model) === "anthropic" ? claudeJson(req) : geminiJson(req);
}

// ── Batches (Claude only) ─────────────────────────────────────────────
// Asynchronous processing at half price; results within 24 hours. The caller
// keeps the custom ids, submits, polls, and reads results back as AiJsonResult.

export interface BatchRequest { customId: string; request: AiJsonRequest }
export interface BatchStatus { id: string; ended: boolean; counts: { processing: number; succeeded: number; errored: number; canceled: number; expired: number } }
export type BatchItemResult = { customId: string; ok: true; result: AiJsonResult } | { customId: string; ok: false; error: string };

export async function createBatch(requests: BatchRequest[]): Promise<string> {
  if (requests.some((r) => providerOf(r.request.model) !== "anthropic")) throw new Error("Los lotes solo están disponibles con modelos Claude");
  const batch = await anthropic().messages.batches.create({
    requests: requests.map((r) => ({ custom_id: r.customId, params: claudeParams(r.request) })),
  });
  return batch.id;
}

export async function getBatch(id: string): Promise<BatchStatus> {
  const batch = await anthropic().messages.batches.retrieve(id);
  return { id: batch.id, ended: batch.processing_status === "ended", counts: batch.request_counts };
}

export async function batchResults(id: string, requests: Map<string, AiJsonRequest>): Promise<BatchItemResult[]> {
  const out: BatchItemResult[] = [];
  for await (const item of await anthropic().messages.batches.results(id)) {
    const req = requests.get(item.custom_id);
    if (item.result.type === "succeeded" && req) {
      try { out.push({ customId: item.custom_id, ok: true, result: claudeResult(item.result.message, req) }); }
      catch (e) { out.push({ customId: item.custom_id, ok: false, error: e instanceof Error ? e.message : String(e) }); }
    } else {
      const error = item.result.type === "errored" ? JSON.stringify(item.result.error).slice(0, 300) : item.result.type;
      out.push({ customId: item.custom_id, ok: false, error });
    }
  }
  return out;
}
