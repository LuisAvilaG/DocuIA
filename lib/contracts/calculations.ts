import { normalizeContractNumber } from "./normalization";
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

/**
 * Where one side of the operation comes from. Kept with the result so the case
 * can show "base × factor = result" and what the base was read from.
 */
export interface CalculationPart {
  source: "field" | "fixed" | "item" | "number";
  /** Field key, fixed-value key, item column or the literal number. */
  name: string;
  /** Label of a fixed value. */
  label?: string;
  /** Document type of a field. */
  docType?: string;
  /** The number used when it is one for the whole calculation; null when it changes per item. */
  value: number | null;
}

export interface CalculationItemResult {
  values: Record<string, string>;
  evidence?: string | null;
  value: number | null;
  status: "ok" | "missing" | "error";
  reason?: string;
  /** The two numbers of this item's operation (absent in cases analysed before they were kept). */
  base?: number | null;
  operand?: number | null;
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
  /** Operation and origin of its two sides (absent in cases analysed before they were kept). */
  operation?: CalculationOperation;
  parts?: { base: CalculationPart; operand: CalculationPart };
}

type DocsByTypeLike = Record<string, Array<{ values: Record<string, unknown> }>>;

function toNumber(value: unknown): number | null {
  // Same reading as validations and approval steps: a text with two figures is not a number.
  return normalizeContractNumber(value);
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
  // Same document choice as validations: the first one (newest first) that has the field.
  const documents = docsByType[ref.docType] ?? [];
  const present = (v: unknown) => Array.isArray(v) ? v.length > 0 : v !== null && v !== undefined && String(v).trim() !== "";
  const raw = (documents.find((document) => present(document.values[ref.field])) ?? documents[0])?.values[ref.field];
  return toNumber(Array.isArray(raw) ? raw[0] : raw);
}

function partOf(ref: CalculationReference | CalculationOperand | number, definition: CalculationDefinition, value: number | null): CalculationPart {
  if (typeof ref === "number") return { source: "number", name: String(ref), value: ref };
  if (ref.type === "number") return { source: "number", name: String(ref.value), value: ref.value };
  if (ref.type === "fixed") return { source: "fixed", name: ref.key, label: definition.fixedValues?.find((fixed) => fixed.key === ref.key)?.label, value };
  if (ref.type === "item") return { source: "item", name: ref.key, value: null };
  return { source: "field", name: ref.field, docType: ref.docType, value };
}

/**
 * Operation of a stored result taken from a fresh evaluation of the same case.
 * Only where the result is the same number: a stored value is never explained
 * with an operation that gives something else.
 */
export function adoptParts(stored: CalculationResult, fresh: CalculationResult | undefined): CalculationResult {
  if (stored.parts || !fresh?.parts || !fresh.operation) return stored;
  if (stored.items) {
    const items = fresh.items ?? [];
    if (items.length !== stored.items.length || stored.items.some((item, index) => item.value !== items[index].value)) return stored;
    return { ...stored, operation: fresh.operation, parts: fresh.parts, items: stored.items.map((item, index) => ({ ...item, base: items[index].base, operand: items[index].operand })) };
  }
  return stored.value === fresh.value ? { ...stored, operation: fresh.operation, parts: fresh.parts } : stored;
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
    const { operation } = definition;

    if (itemMode) {
      const rawItems = analysisItemsByNode[definition.analysisNodeId ?? ""] ?? [];
      const filtered = definition.itemFilter?.key
        ? rawItems.filter((entry) => entry.values[definition.itemFilter!.key]?.trim().toLowerCase() === definition.itemFilter!.value.trim().toLowerCase())
        : rawItems;
      const items = filtered.map((entry) => {
        const base = resolveReference(definition.base, docsByType, fixed, entry.values);
        const operand = resolveReference(definition.operand, docsByType, fixed, entry.values);
        const sides = { values: entry.values, evidence: entry.evidence, base, operand };
        if (base === null || operand === null) {
          return { ...sides, value: null, status: "missing" as const, reason: "Falta un valor de la fórmula en este elemento." };
        }
        const result = apply(base, operation, operand);
        if (result === null) return { ...sides, value: null, status: "error" as const, reason: "No es posible dividir entre cero." };
        const factor = 10 ** definition.decimals;
        return { ...sides, value: Math.round((result + Number.EPSILON) * factor) / factor, status: "ok" as const };
      });
      return {
        key: definition.key, label: definition.label, value: null,
        status: items.length > 0 && items.every((item) => item.status === "ok") ? "ok" : "missing",
        formula, sourceValue: null,
        reason: items.length ? undefined : "No se encontraron elementos para calcular.",
        items,
        operation,
        // A side read from each item has no single value; the others are the same for every item.
        parts: {
          base: partOf(definition.base, definition, resolveReference(definition.base, docsByType, fixed)),
          operand: partOf(definition.operand, definition, resolveReference(definition.operand, docsByType, fixed)),
        },
      };
    }

    const base = resolveReference(definition.base, docsByType, fixed);
    const operand = base === null ? null : resolveReference(definition.operand, docsByType, fixed);
    const shown = { operation, parts: { base: partOf(definition.base, definition, base), operand: partOf(definition.operand, definition, operand) } };
    if (base === null) {
      return { key: definition.key, label: definition.label, value: null, status: "missing", sourceValue: null, formula, reason: "No se encontró el valor base de este cálculo.", ...shown };
    }
    if (operand === null) {
      return { key: definition.key, label: definition.label, value: null, status: "missing", sourceValue: base, formula, reason: "No se encontró el segundo valor de la fórmula.", ...shown };
    }
    const value = apply(base, operation, operand);
    if (value === null) {
      return { key: definition.key, label: definition.label, value: null, status: "error", sourceValue: base, formula, reason: "No es posible dividir entre cero.", ...shown };
    }
    const factor = 10 ** definition.decimals;
    return { key: definition.key, label: definition.label, value: Math.round((value + Number.EPSILON) * factor) / factor, status: "ok", sourceValue: base, formula, ...shown };
  });
}
