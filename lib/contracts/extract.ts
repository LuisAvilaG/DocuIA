// Contract Intelligence — Gemini-backed classification + field extraction.
// The functions here are the REAL implementations; the pipeline accepts them as
// injectable deps so it can be tested with stubs (no API key required).

const FLASH_MODEL = "gemini-2.5-flash";
const GEMINI_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS) || 90_000;
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 4;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function getApiKey(override?: string): string {
  const key = (override || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || "").trim();
  if (!key) throw new Error("Falta GOOGLE_API_KEY/GEMINI_API_KEY para el análisis de contratos");
  return key;
}

function parseJson(text: string): Record<string, unknown> {
  const raw = String(text || "").trim();
  if (!raw) return {};
  try { return JSON.parse(raw); }
  catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("La IA no devolvió JSON válido");
    return JSON.parse(m[0]);
  }
}

type Part = Record<string, unknown>;

async function geminiJson(parts: Part[], apiKeyOverride?: string): Promise<Record<string, unknown>> {
  const apiKey = getApiKey(apiKeyOverride);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${FLASH_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
  let response: Response | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(Math.min(8000, 500 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 300));
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { temperature: 0, responseMimeType: "application/json" } }),
        cache: "no-store",
        signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
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
  const json = await response!.json() as Record<string, unknown>;
  const candidates = Array.isArray(json?.candidates) ? json.candidates : [];
  let text = "";
  for (const c of candidates) {
    const cp = (c as { content?: { parts?: { text?: string }[] } })?.content?.parts ?? [];
    for (const p of cp) { if (p?.text) { text = p.text; break; } }
    if (text) break;
  }
  return parseJson(text);
}

// ── Types shared with the pipeline ────────────────────────────────────
export interface DocTypeOption { key: string; name: string; hint?: string | null }
export interface FieldDef { fieldKey: string; label: string; isList: boolean }

// A document source is either extracted text (born-digital) or the raw file
// (scanned PDF/image) sent to Gemini multimodally for OCR + understanding.
export type ExtractSource =
  | { kind: "text"; text: string }
  | { kind: "file"; base64: string; mimeType: string };

export interface ClassifyFn {
  (source: ExtractSource, docTypes: DocTypeOption[], apiKey?: string): Promise<string>;
}
export interface ExtractFn {
  (source: ExtractSource, docTypeName: string, fields: FieldDef[], apiKey?: string):
    Promise<{ values: Record<string, unknown>; citations: Record<string, unknown> }>;
}

// Build the Gemini request parts: inline text, or the file as inline_data
// (Gemini reads scanned PDFs/images directly — this is the OCR path).
function buildParts(instruction: string, source: ExtractSource): Part[] {
  if (source.kind === "text") {
    return [{ text: `${instruction}\n\nDocumento:\n${source.text.slice(0, 24000)}` }];
  }
  return [
    { text: `${instruction}\n\nEl documento va adjunto (puede ser un escaneo; transcríbelo con cuidado, reconstruyendo caracteres degradados por contexto).` },
    { inline_data: { mime_type: source.mimeType, data: source.base64 } },
  ];
}

// ── Real implementations ──────────────────────────────────────────────
export const classifyDocument: ClassifyFn = async (source, docTypes, apiKey) => {
  const options = docTypes.map((d) => `- ${d.key}: ${d.name}${d.hint ? ` (${d.hint})` : ""}`).join("\n");
  const instruction =
    "Clasifica el documento en UNO de estos tipos según su FUNCIÓN LEGAL, no cómo se autodenomine.\n" +
    `Tipos:\n${options}\n` +
    'Responde SOLO JSON: {"type_key":"..."}. Si ninguno aplica, usa "unknown".';
  const res = await geminiJson(buildParts(instruction, source), apiKey);
  const key = String(res.type_key ?? res.typeKey ?? "unknown");
  return docTypes.some((d) => d.key === key) ? key : "unknown";
};

export const extractContractFields: ExtractFn = async (source, docTypeName, fields, apiKey) => {
  const fieldList = fields.map((f) => `- ${f.fieldKey} (${f.label})${f.isList ? " [lista]" : ""}`).join("\n");
  const instruction =
    `Extrae los siguientes campos de un documento tipo "${docTypeName}". NO inventes: si un dato no está, usa null.\n` +
    `Campos:\n${fieldList}\n` +
    'Devuelve SOLO JSON: {"values":{campo:valor}, "citations":{campo:"cita literal 6-12 palabras"}}.\n' +
    "Para campos [lista], values[campo] es un array y citations[campo] es un array de citas en el mismo orden.\n" +
    "IMPORTANTE para campos [lista]: incluye TODOS los elementos que aparezcan en CUALQUIER parte del documento " +
    "(todas las partes contratantes —mandante y contratista—, comparecencia, cláusulas de personería y bloque de firmas), " +
    "sin omitir a ninguno. Para personas, usa el formato \"NOMBRE\" o \"NOMBRE (en representación de SOCIEDAD)\" cuando conste.";
  const res = await geminiJson(buildParts(instruction, source), apiKey);
  return {
    values: (res.values ?? {}) as Record<string, unknown>,
    citations: (res.citations ?? {}) as Record<string, unknown>,
  };
};

export interface ContractExtractDeps { classify: ClassifyFn; extract: ExtractFn }
export const realExtractDeps: ContractExtractDeps = { classify: classifyDocument, extract: extractContractFields };
