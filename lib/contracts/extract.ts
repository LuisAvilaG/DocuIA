// Contract Intelligence — classification + field extraction on top of the
// provider layer (Gemini or Claude, chosen per organization). The functions
// here are the REAL implementations; the pipeline accepts them as injectable
// deps so it can be tested with stubs (no API key required).

import { generateJson, type AiPart } from "@/lib/ai/provider";
import { visualTrainingPrompt, type VisualTrainingVariant } from "./visual-training";

export const DEFAULT_CONTRACT_MODEL = "gemini-2.5-flash";
// Born-digital text uploads (TXT/XML) are bounded here; PDFs never reach this
// path whole once they are long enough for the page locator.
const MAX_TEXT_CHARS = 400_000;

// ── Types shared with the pipeline ────────────────────────────────────
export interface DocTypeOption { key: string; name: string; hint?: string | null }
export interface FieldDef { fieldKey: string; label: string; isList: boolean }
export interface ExtractionLearning {
  fieldKey: string;
  originalValue: string | null;
  correctedValue: string;
  citation: string | null;
}

// A document source is either extracted text (born-digital, or the located
// pages of a long document) or a file (scanned PDF/image, or the located pages
// cut into a small PDF) the model reads directly.
export type ExtractSource =
  | { kind: "text"; text: string }
  | { kind: "file"; base64: string; mimeType: string };

export interface ClassifyFn {
  (source: ExtractSource, docTypes: DocTypeOption[], apiKey?: string, fileName?: string): Promise<string>;
}
export interface ExtractFn {
  (source: ExtractSource, docTypeName: string, fields: FieldDef[], apiKey?: string, learnings?: ExtractionLearning[], visualVariants?: VisualTrainingVariant[], note?: string):
    Promise<{ values: Record<string, unknown>; citations: Record<string, unknown> }>;
}
export interface ContractExtractDeps { classify: ClassifyFn; extract: ExtractFn }

function buildParts(source: ExtractSource): { parts: AiPart[]; preface: string } {
  if (source.kind === "text") {
    return { parts: [{ kind: "text", text: `Documento:\n${source.text.slice(0, MAX_TEXT_CHARS)}` }], preface: "" };
  }
  return {
    parts: [{ kind: "file", base64: source.base64, mimeType: source.mimeType }],
    preface: "El documento va adjunto (puede ser un escaneo; transcríbelo con cuidado, reconstruyendo caracteres degradados por contexto).\n",
  };
}

/** Real classify/extract functions bound to one model. */
export function createExtractDeps(options: { model?: string } = {}): ContractExtractDeps {
  const model = options.model || DEFAULT_CONTRACT_MODEL;

  const classify: ClassifyFn = async (source, docTypes, apiKey, fileName) => {
    const options = docTypes.map((d) => `- ${d.key}: ${d.name}${d.hint ? ` (${d.hint})` : ""}`).join("\n");
    const { parts, preface } = buildParts(source);
    const instruction =
      preface +
      "Clasifica el documento en UNO de estos tipos según su FUNCIÓN LEGAL, no cómo se autodenomine.\n" +
      `Tipos:\n${options}\n` +
      (fileName ? `El archivo se llama \"${fileName}\". Úsalo como señal adicional, pero confirma siempre con el contenido.\n` : "") +
      'Responde SOLO JSON: {"type_key":"..."}. Si ninguno aplica, usa "unknown".';
    const { json } = await generateJson({ model, instruction, parts, apiKey, maxOutputTokens: 512 });
    const key = String(json.type_key ?? json.typeKey ?? "unknown");
    return docTypes.some((d) => d.key === key) ? key : "unknown";
  };

  const extract: ExtractFn = async (source, docTypeName, fields, apiKey, learnings = [], visualVariants = [], note) => {
    const fieldList = fields.map((f) => `- ${f.fieldKey} (${f.label})${f.isList ? " [lista]" : ""}`).join("\n");
    const learningContext = learnings.length === 0 ? "" :
      "\nAprendizajes aprobados por este tenant (son ejemplos de interpretación, NO copies sus valores si no están en este documento):\n" +
      learnings.slice(0, 8).map((learning) =>
        `- ${learning.fieldKey}: se corrigió de "${learning.originalValue?.slice(0, 180) || "sin valor"}" a "${learning.correctedValue.slice(0, 180)}"${learning.citation ? `, evidencia: "${learning.citation.slice(0, 180)}"` : ""}`,
      ).join("\n") + "\nUsa estos ejemplos para reconocer el campo; extrae siempre el valor y la cita del documento actual.";
    const { parts, preface } = buildParts(source);
    const instruction =
      preface +
      (note ? `${note}\n` : "") +
      `Extrae los siguientes campos de un documento tipo "${docTypeName}". NO inventes: si un dato no está, usa null.\n` +
      `Campos:\n${fieldList}\n` +
      'Devuelve SOLO JSON: {"values":{campo:valor}, "citations":{campo:"cita literal 6-12 palabras"}}.\n' +
      "Para campos [lista], values[campo] es un array y citations[campo] es un array de citas en el mismo orden.\n" +
      "IMPORTANTE para campos [lista]: incluye TODOS los elementos que aparezcan en CUALQUIER parte del documento " +
      "(todas las partes contratantes —mandante y contratista—, comparecencia, cláusulas de personería y bloque de firmas), " +
      "sin omitir a ninguno. Para personas, usa el formato \"NOMBRE\" o \"NOMBRE (en representación de SOCIEDAD)\" cuando conste." +
      learningContext + visualTrainingPrompt(visualVariants);
    const { json } = await generateJson({ model, instruction, parts, apiKey, maxOutputTokens: 8000 });
    return {
      values: (json.values ?? {}) as Record<string, unknown>,
      citations: (json.citations ?? {}) as Record<string, unknown>,
    };
  };

  return { classify, extract };
}

export const realExtractDeps: ContractExtractDeps = createExtractDeps();
export const classifyDocument: ClassifyFn = (...args) => realExtractDeps.classify(...args);
export const extractContractFields: ExtractFn = (...args) => realExtractDeps.extract(...args);
