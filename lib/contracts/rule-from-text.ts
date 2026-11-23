// Escribir un control del flujo en palabras: la IA lo traduce al formato de
// reglas del flujo. Solo se acepta si valida contra el mismo esquema que usa el
// editor y si usa documentos y campos que existen en el flujo.
import { generateJson, isKnownModel } from "@/lib/ai/provider";
import { DEFAULT_CONTRACT_MODEL } from "./extract";
import { ruleSchema } from "./flow";

export interface RuleContext {
  docTypes: Array<{ key: string; name: string }>;
  fieldsByType: Record<string, string[]>;
}

export type RuleFromText =
  | { ok: true; name: string; severity: "info" | "warn" | "block"; rule: Record<string, unknown>; explanation: string }
  | { ok: false; error: string };

const SHAPES = `Tipos de regla (usa exactamente estas formas; "ref" es {"docType":"<clave>","field":"<campo>"}):
- cross_reference: cada elemento de una lista debe aparecer en otro documento. {"kind":"cross_reference","subjects":ref,"membership":{...ref,"label":"<nombre del documento>"}}
- field_match: dos campos deben coincidir (o diferir). {"kind":"field_match","left":ref,"right":ref,"mode":"equal"|"different","numericTolerance":<número opcional>}
- clause_presence: un campo-cláusula debe estar (o no). {"kind":"clause_presence","docType":"<clave>","field":"<campo>","mustExist":true|false}
- numeric_threshold: un número dentro de un mínimo y/o máximo. {"kind":"numeric_threshold","docType":"<clave>","field":"<campo>","min":<número>,"max":<número>}
- date_rule: fecha no vencida y/o anterior a otra. {"kind":"date_rule","docType":"<clave>","field":"<campo>","notExpired":true,"before":ref}
- field_format: formato de un campo. {"kind":"field_format","docType":"<clave>","field":"<campo>","format":"tax_id"|"email"|"date"|"number"|"nonempty","country":"CL"|"MX"|"AR"|"CO"|"PE"|"EC"|"BR"|"PY"}
- document_required: tipos de documento que deben estar. {"kind":"document_required","docTypes":["<clave>",...]}
- signatures_complete: todas las partes firmaron. {"kind":"signatures_complete","subjects":ref,"signatures":ref}`;

/** Campos y documentos que usa una regla y no existen en el flujo. */
export function unknownRefs(rule: Record<string, unknown>, ctx: RuleContext): string[] {
  const keys = new Set(ctx.docTypes.map((d) => d.key));
  const bad: string[] = [];
  const check = (r: unknown) => {
    const o = r as { docType?: unknown; field?: unknown } | null;
    if (!o || typeof o.docType !== "string") return;
    if (!keys.has(o.docType)) bad.push(`documento «${o.docType}»`);
    else if (typeof o.field === "string" && !(ctx.fieldsByType[o.docType] ?? []).includes(o.field)) bad.push(`campo «${o.field}»`);
  };
  check(rule);
  for (const k of ["subjects", "membership", "confirmation", "left", "right", "before", "signatures"]) check(rule[k]);
  if (Array.isArray(rule.docTypes)) for (const d of rule.docTypes) if (typeof d === "string" && !keys.has(d)) bad.push(`documento «${d}»`);
  return bad;
}

export async function ruleFromText(text: string, ctx: RuleContext, model?: string): Promise<RuleFromText> {
  if (ctx.docTypes.length === 0) return { ok: false, error: "Primero agrega al flujo los documentos esperados y sus datos." };
  const catalog = ctx.docTypes.map((d) => `- ${d.key} (${d.name}): ${(ctx.fieldsByType[d.key] ?? []).join(", ") || "sin campos"}`).join("\n");
  const instruction =
    "Conviertes la descripción de un control de contratos en una regla JSON. Responde SOLO JSON con esta forma: " +
    '{"name":"<nombre corto>","severity":"block"|"warn"|"info","rule":{...},"explanation":"<una frase en español de lo que revisa>","error":"<solo si no se puede>"}.\n' +
    "Usa solo las claves de documento y campos del catálogo. Si la descripción no encaja en ningún tipo o falta un campo, deja rule vacío y explica en error qué falta. " +
    "La severidad es block si dice que bloquea, impide o es obligatorio; info si es solo informativo; si no, warn.\n\n" + SHAPES;
  const { json } = await generateJson({
    model: model && isKnownModel(model) ? model : DEFAULT_CONTRACT_MODEL,
    instruction,
    parts: [{ kind: "text", text: `Catálogo del flujo (clave (nombre): campos):\n${catalog}\n\nDescripción del control:\n${text.slice(0, 2000)}` }],
    maxOutputTokens: 1200,
  });
  if (typeof json.error === "string" && json.error.trim() && (!json.rule || Object.keys(json.rule as object).length === 0)) {
    return { ok: false, error: json.error.trim() };
  }
  const parsed = ruleSchema.safeParse(json.rule);
  if (!parsed.success || parsed.data.kind === "ai_analysis") return { ok: false, error: "No pude convertirlo en un control. Prueba nombrar el documento y el dato que se revisa." };
  const rule = parsed.data as Record<string, unknown>;
  const bad = unknownRefs(rule, ctx);
  if (bad.length) return { ok: false, error: `El flujo no tiene ${bad.join(", ")}. Agrégalo en Extracción o reformula.` };
  const severity = json.severity === "block" || json.severity === "info" ? json.severity : "warn";
  return {
    ok: true,
    name: String(json.name ?? "").trim().slice(0, 120) || "Control",
    severity,
    rule,
    explanation: String(json.explanation ?? "").trim().slice(0, 400),
  };
}
