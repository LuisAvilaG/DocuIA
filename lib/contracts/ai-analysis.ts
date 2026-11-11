import { generateJson, isKnownModel, type JsonSchema } from "@/lib/ai/provider";
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

/** Modelo del análisis con IA cuando el cliente no eligió otro. */
export const DEFAULT_ANALYSIS_MODEL = "claude-sonnet-5-5";

/**
 * Una llamada al modelo por la capa común de proveedores (Claude o Gemini).
 * La instrucción fija va como sistema (se cachea); los datos del caso, aparte.
 */
async function requestJson(instruction: string, content: string, model: string, schema?: JsonSchema): Promise<Record<string, unknown>> {
  const { json } = await generateJson({
    model: isKnownModel(model) ? model : DEFAULT_ANALYSIS_MODEL,
    instruction,
    parts: [{ kind: "text", text: content }],
    schema,
    maxOutputTokens: 8000,
    timeoutMs: 120_000,
  });
  return json;
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

/** Forma exacta de la respuesta: los hallazgos llevan las columnas que definió el cliente. */
export function analysisSchema(outputFields: NonNullable<AiAnalysisRule["outputFields"]>): JsonSchema {
  const itemProps: Record<string, JsonSchema> = Object.fromEntries(outputFields.map((f) => [f.key, { type: "string", description: f.label }]));
  itemProps.evidence = { type: "string", description: "Cita literal que sustenta el hallazgo, o vacío si no hay" };
  return {
    type: "object",
    properties: {
      outcome: { type: "string", enum: ["pass", "review", "block"] },
      summary: { type: "string", description: "Resumen; vacío si el formato es solo estructurado" },
      items: { type: "array", items: { type: "object", properties: itemProps, required: Object.keys(itemProps), additionalProperties: false } },
      citations: { type: "array", items: { type: "string" } },
    },
    required: ["outcome", "summary", "items", "citations"],
    additionalProperties: false,
  };
}

export async function runAiAnalysis(rule: AiAnalysisRule, docsByType: DocsByType, model: string = DEFAULT_ANALYSIS_MODEL): Promise<AiAnalysisResponse> {
  const outputMode = rule.outputMode ?? "free";
  const outputFields = rule.outputFields ?? [];
  const prompt = rule.improvedPrompt?.trim() || rule.prompt.trim();
  const schema = outputFields.length
    ? outputFields.map((field) => `- ${field.key}: ${field.label}${field.description ? ` (${field.description})` : ""}`).join("\n")
    : "No se solicitaron columnas estructuradas.";
  const result = await requestJson(
    "Actúas como analista contractual. Trabaja exclusivamente con la evidencia proporcionada. " +
    "No inventes obligaciones, coberturas, cifras ni hechos. Cuando no exista evidencia suficiente, indícalo claramente. " +
    "Una recomendación debe explicar por qué aplica y citar el texto disponible que la sustenta. " +
    "Compara fechas, valores y nombres con cuidado: un valor actualizado por un otrosí o una modificación reemplaza al anterior, " +
    "y una cobertura que empieza después de lo exigido no cubre ese tramo.\n\n" +
    "Responde en JSON con outcome, summary, items (un objeto por hallazgo, con exactamente las columnas pedidas y evidence) y citations.\n\n" +
    "outcome significa: pass si no se requiere acción, review si una persona debe revisar o decidir, block si las reglas internas impiden continuar. " +
    "Si el formato es libre, usa summary y deja items vacío. Si es estructurado, prioriza items y deja summary breve. Si es ambos, completa ambos.",
    `OBJETIVO DEL USUARIO:\n${prompt}\n\n` +
    `REGLAS INTERNAS DEL CLIENTE:\n${rule.internalRules?.trim() || "No se definieron reglas internas adicionales."}\n\n` +
    `FORMATO SOLICITADO: ${outputMode}\n` +
    `CAMPOS PARA CADA HALLAZGO ESTRUCTURADO:\n${schema}\n\n` +
    `EXPEDIENTE:\n${buildAiAnalysisContext(docsByType, rule.sourceDocTypes) || "No hay datos extraídos de los documentos seleccionados."}`,
    model,
    analysisSchema(outputFields),
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
export async function improveAiAnalysisPrompt(draft: string, model: string = DEFAULT_ANALYSIS_MODEL): Promise<string> {
  const result = await requestJson(
    "Mejora la siguiente instrucción para un análisis contractual. Conserva exactamente su objetivo, usa español claro, " +
    "exige evidencia textual, prohíbe inventar datos y señala incertidumbre. No agregues requisitos no solicitados. " +
    'Devuelve SOLO JSON: {"prompt":"..."}.',
    `INSTRUCCIÓN ORIGINAL:\n${draft.slice(0, 10000)}`,
    model,
  );
  const improved = cleanText(result.prompt, 12000);
  if (!improved) throw new Error("La IA no devolvió una mejora del prompt.");
  return improved;
}
