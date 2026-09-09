export const CALCULATION_OPERATIONS = ["percentage", "multiply", "add", "subtract", "divide"] as const;
export type CalculationOperation = typeof CALCULATION_OPERATIONS[number];

/** A named constant belongs to the calculation node, never to the model. */
export interface FixedCalculationValue {
  key: string;
  label: string;
  value: number;
}

export type CalculationReference =
  | { type?: "field"; docType: string; field: string }
  | { type: "fixed"; key: string };

export type CalculationOperand =
  | { type: "number"; value: number }
  | CalculationReference
  | { type: "item"; key: string };

export interface CalculationDefinition {
  key: string;
  label: string;
  base: CalculationReference;
  operation: CalculationOperation;
  /** Legacy flows store a number. New flows can reference another value. */
  operand: number | CalculationOperand;
  decimals: number;
  fixedValues?: FixedCalculationValue[];
  /** Apply the same formula to every structured item returned by an AI analysis. */
  mode?: "single" | "each_analysis_item";
  analysisNodeId?: string;
  /** Optional equality filter, e.g. type_calculo = "porcentaje". */
  itemFilter?: { key: string; value: string };
}

export interface CalculationItemResult {
  values: Record<string, string>;
  evidence?: string | null;
  value: number | null;
  status: "ok" | "missing" | "error";
  reason?: string;
}

export interface CalculationResult {
  key: string;
  label: string;
  value: number | null;
  status: "ok" | "missing" | "error";
  formula: string;
  sourceValue: number | null;
  reason?: string;
  items?: CalculationItemResult[];
}

type DocsByTypeLike = Record<string, Array<{ values: Record<string, unknown> }>>;

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  let raw = value.trim().replace(/[^\d,.-]/g, "");
  if (!raw) return null;
  const commas = [...raw.matchAll(/,/g)].map((match) => match.index ?? 0);
  const dots = [...raw.matchAll(/\./g)].map((match) => match.index ?? 0);
  const lastComma = commas.at(-1) ?? -1;
  const lastDot = dots.at(-1) ?? -1;
  const decimal = lastComma > lastDot ? "," : ".";
  const lastSeparator = Math.max(lastComma, lastDot);
  const decimals = lastSeparator >= 0 ? raw.length - lastSeparator - 1 : 0;

  // A single separator followed by three digits is conventionally a thousands
  // separator in contract values ("4.603.482.380" / "4,603,482,380").
  if ((commas.length + dots.length > 1) || decimals === 3) {
    raw = raw.replace(/[.,]/g, "");
  } else if (lastSeparator >= 0) {
    raw = raw.replace(decimal === "," ? /\./g : /,/g, "").replace(decimal, ".");
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function refName(ref: CalculationReference | CalculationOperand | number): string {
  if (typeof ref === "number") return String(ref);
  if (ref.type === "number") return String(ref.value);
  if (ref.type === "item" || ref.type === "fixed") return ref.key;
  return ref.field;
}

function formulaText(operation: CalculationOperation, operand: CalculationOperand | number): string {
  const name = refName(operand);
  if (operation === "percentage") return `base × ${name}%`;
  if (operation === "multiply") return `base × ${name}`;
  if (operation === "add") return `base + ${name}`;
  if (operation === "subtract") return `base − ${name}`;
  return `base ÷ ${name}`;
}

function apply(base: number, operation: CalculationOperation, operand: number): number | null {
  if (operation === "percentage") return base * operand / 100;
  if (operation === "multiply") return base * operand;
  if (operation === "add") return base + operand;
  if (operation === "subtract") return base - operand;
  return operand === 0 ? null : base / operand;
}

function resolveReference(
  ref: CalculationReference | CalculationOperand | number,
  docsByType: DocsByTypeLike,
  fixed: Map<string, number>,
  item?: Record<string, string>,
): number | null {
  if (typeof ref === "number") return ref;
  if (ref.type === "number") return ref.value;
  if (ref.type === "fixed") return fixed.get(ref.key) ?? null;
  if (ref.type === "item") return toNumber(item?.[ref.key]);
  const documents = docsByType[ref.docType] ?? [];
  const raw = documents.at(-1)?.values[ref.field];
  return toNumber(Array.isArray(raw) ? raw[0] : raw);
}

export type AnalysisCalculationItem = { values: Record<string, string>; evidence?: string | null };

/**
 * Executes deterministic flow calculations. The model supplies values and
 * evidence only; every arithmetic operation is performed here.
 */
export function evaluateCalculations(
  definitions: CalculationDefinition[],
  docsByType: DocsByTypeLike,
  analysisItemsByNode: Record<string, AnalysisCalculationItem[]> = {},
): CalculationResult[] {
  return definitions.map((definition) => {
    const fixed = new Map((definition.fixedValues ?? []).map((value) => [value.key, value.value]));
    const formula = formulaText(definition.operation, definition.operand);
    const itemMode = definition.mode === "each_analysis_item";

    if (itemMode) {
      const rawItems = analysisItemsByNode[definition.analysisNodeId ?? ""] ?? [];
      const filtered = definition.itemFilter?.key
        ? rawItems.filter((entry) => entry.values[definition.itemFilter!.key]?.trim().toLowerCase() === definition.itemFilter!.value.trim().toLowerCase())
        : rawItems;
      const items = filtered.map((entry) => {
        const base = resolveReference(definition.base, docsByType, fixed, entry.values);
        const operand = resolveReference(definition.operand, docsByType, fixed, entry.values);
        if (base === null || operand === null) {
          return { values: entry.values, evidence: entry.evidence, value: null, status: "missing" as const, reason: "Falta un valor de la fórmula en este elemento." };
        }
        const result = apply(base, definition.operation, operand);
        if (result === null) return { values: entry.values, evidence: entry.evidence, value: null, status: "error" as const, reason: "No es posible dividir entre cero." };
        const factor = 10 ** definition.decimals;
        return { values: entry.values, evidence: entry.evidence, value: Math.round((result + Number.EPSILON) * factor) / factor, status: "ok" as const };
      });
      return {
        key: definition.key, label: definition.label, value: null,
        status: items.length > 0 && items.every((item) => item.status === "ok") ? "ok" : "missing",
        formula, sourceValue: null,
        reason: items.length ? undefined : "No se encontraron elementos para calcular.",
        items,
      };
    }

    const base = resolveReference(definition.base, docsByType, fixed);
    if (base === null) {
      return { key: definition.key, label: definition.label, value: null, status: "missing", sourceValue: null, formula, reason: "No se encontró el valor base de este cálculo." };
    }
    const operand = resolveReference(definition.operand, docsByType, fixed);
    if (operand === null) {
      return { key: definition.key, label: definition.label, value: null, status: "missing", sourceValue: base, formula, reason: "No se encontró el segundo valor de la fórmula." };
    }
    const value = apply(base, definition.operation, operand);
    if (value === null) {
      return { key: definition.key, label: definition.label, value: null, status: "error", sourceValue: base, formula, reason: "No es posible dividir entre cero." };
    }
    const factor = 10 ** definition.decimals;
    return { key: definition.key, label: definition.label, value: Math.round((value + Number.EPSILON) * factor) / factor, status: "ok", sourceValue: base, formula };
  });
}
