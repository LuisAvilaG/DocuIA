import type { DocsByType, ValidationRule } from "./validate";

export type AiAnalysisRule = Extract<ValidationRule, { kind: "ai_analysis" }>;
export type AiAnalysisOutcome = "pass" | "review" | "block";

export interface AiAnalysisItem {
  values: Record<string, string>;
  evidence: string | null;
}

export interface AiAnalysisResponse {
  outcome: AiAnalysisOutcome;
  summary: string | null;
  items: AiAnalysisItem[];
  citations: string[];
}

const MODEL = "gemini-2.5-flash";
const TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS) || 90_000;

function getApiKey(): string {
  const key = (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || "").trim();
  if (!key) throw new Error("Falta GOOGLE_API_KEY/GEMINI_API_KEY para el análisis con IA.");
  return key;
}

function jsonObject(raw: string): Record<string, unknown> {
  const clean = raw.trim();
  try { return JSON.parse(clean) as Record<string, unknown>; }
  catch {
    const match = clean.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("La IA no devolvió una respuesta estructurada.");
    return JSON.parse(match[0]) as Record<string, unknown>;
  }
}

async function requestJson(instruction: string): Promise<Record<string, unknown>> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(getApiKey())}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: instruction }] }],
        generationConfig: { temperature: 0, responseMimeType: "application/json" },
      }),
    },
  );
  if (!response.ok) throw new Error(`La IA no pudo completar el análisis (${response.status}).`);
  const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = payload.candidates?.flatMap((candidate) => candidate.content?.parts ?? []).find((part) => part.text)?.text;
  if (!text) throw new Error("La IA no devolvió contenido para el análisis.");
  return jsonObject(text);
}

function cleanText(value: unknown, max = 1800): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Converts the extracted case data into a compact, evidence-first context. */
export function buildAiAnalysisContext(docsByType: DocsByType, sourceDocTypes?: string[]): string {
  const selected = sourceDocTypes && sourceDocTypes.length > 0 ? new Set(sourceDocTypes) : null;
  const sections: string[] = [];
  for (const [type, docs] of Object.entries(docsByType)) {
    if (selected && !selected.has(type)) continue;
    docs.forEach((doc, index) => {
      const fields = Object.entries(doc.values)
        .map(([key, value]) => `- ${key}: ${cleanText(Array.isArray(value) ? value.join(" | ") : value)}`)
        .join("\n");
      const citations = Object.entries(doc.citations)
        .map(([key, value]) => `- ${key}: ${cleanText(Array.isArray(value) ? value.join(" | ") : value, 500)}`)
        .join("\n");
      sections.push(`DOCUMENTO ${type}${docs.length > 1 ? ` #${index + 1}` : ""}\nDATOS EXTRAÍDOS:\n${fields || "(sin datos extraídos)"}\nCITAS DISPONIBLES:\n${citations || "(sin citas)"}`);
    });
  }
  return sections.join("\n\n").slice(0, 48_000);
}

function parseOutcome(value: unknown): AiAnalysisOutcome {
  const normalized = String(value ?? "review").trim().toLowerCase();
  return normalized === "pass" || normalized === "block" ? normalized : "review";
}

function parseItems(value: unknown, outputFields: NonNullable<AiAnalysisRule["outputFields"]>): AiAnalysisItem[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 40).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const raw = item as Record<string, unknown>;
    const values: Record<string, string> = {};
    for (const field of outputFields) values[field.key] = cleanText(raw[field.key], 1200);
    return [{ values, evidence: cleanText(raw.evidence ?? raw.citation ?? "", 800) || null }];
  });
}

export async function runAiAnalysis(rule: AiAnalysisRule, docsByType: DocsByType): Promise<AiAnalysisResponse> {
  const outputMode = rule.outputMode ?? "free";
  const outputFields = rule.outputFields ?? [];
  const prompt = rule.improvedPrompt?.trim() || rule.prompt.trim();
  const schema = outputFields.length
    ? outputFields.map((field) => `- ${field.key}: ${field.label}${field.description ? ` (${field.description})` : ""}`).join("\n")
    : "No se solicitaron columnas estructuradas.";
  const result = await requestJson(
    "Actúas como analista contractual. Trabaja exclusivamente con la evidencia proporcionada. " +
    "No inventes obligaciones, coberturas, cifras ni hechos. Cuando no exista evidencia suficiente, indícalo claramente. " +
    "Una recomendación debe explicar por qué aplica y citar el texto disponible que la sustenta.\n\n" +
    `OBJETIVO DEL USUARIO:\n${prompt}\n\n` +
    `REGLAS INTERNAS DEL CLIENTE:\n${rule.internalRules?.trim() || "No se definieron reglas internas adicionales."}\n\n` +
    `FORMATO SOLICITADO: ${outputMode}\n` +
    `CAMPOS PARA CADA HALLAZGO ESTRUCTURADO:\n${schema}\n\n` +
    "Responde SOLO este JSON:\n" +
    '{"outcome":"pass|review|block","summary":"texto o null","items":[{"campo":"valor","evidence":"cita literal o null"}],"citations":["cita literal"]}\n\n' +
    "outcome significa: pass si no se requiere acción, review si una persona debe revisar o decidir, block si las reglas internas impiden continuar. " +
    "Si el formato es libre, usa summary y deja items vacío. Si es estructurado, prioriza items y deja summary breve. Si es ambos, completa ambos.\n\n" +
    `EXPEDIENTE:\n${buildAiAnalysisContext(docsByType, rule.sourceDocTypes) || "No hay datos extraídos de los documentos seleccionados."}`,
  );
  const citations = Array.isArray(result.citations)
    ? result.citations.map((citation) => cleanText(citation, 800)).filter(Boolean).slice(0, 20)
    : [];
  return {
    outcome: parseOutcome(result.outcome),
    summary: outputMode === "structured" ? null : cleanText(result.summary, 10_000) || null,
    items: outputMode === "free" ? [] : parseItems(result.items, outputFields),
    citations,
  };
}

/** Turns a short user goal into a cautious prompt that the tenant can still edit. */
export async function improveAiAnalysisPrompt(draft: string): Promise<string> {
  const result = await requestJson(
    "Mejora la siguiente instrucción para un análisis contractual. Conserva exactamente su objetivo, usa español claro, " +
    "exige evidencia textual, prohíbe inventar datos y señala incertidumbre. No agregues requisitos no solicitados. " +
    'Devuelve SOLO JSON: {"prompt":"..."}.\n\n' +
    `INSTRUCCIÓN ORIGINAL:\n${draft.slice(0, 10000)}`,
  );
  const improved = cleanText(result.prompt, 12000);
  if (!improved) throw new Error("La IA no devolvió una mejora del prompt.");
  return improved;
}
