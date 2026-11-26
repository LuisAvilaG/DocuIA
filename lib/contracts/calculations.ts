import { normalizeContractDate, normalizeContractNumber } from "./normalization";
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
  /**
   * "Sin que sea inferior a N SMMLV": the result is the greater of the formula
   * and amount × unit. An item without the amount keeps the formula alone.
   */
  minimum?: CalculationMinimum;
  /**
   * Exchange rates (fixed values of the node) for a base written in another
   * currency. Only used when a minimum in local currency has to be compared.
   */
  currency?: { rates: Array<{ code: string; fixedKey: string }> };
  /** Exact dates of each item's term, from the contract dates the item points to. */
  term?: CalculationTerm;
}

export interface CalculationMinimum {
  /** How many units, e.g. the item column minimo_smmlv. */
  amount: number | CalculationOperand;
  /** Value of one unit, e.g. the fixed value smmlv. */
  unit: CalculationReference | { type: "number"; value: number };
}

/**
 * The model says from which contract date a term starts and ends ("inicio",
 * "terminacion"…) and how much is added; the dates are computed here.
 */
export interface CalculationTerm {
  /** Contract date for each name the model may answer, e.g. terminacion → contrato.fecha_terminacion. */
  anchors: Record<string, { docType: string; field: string }>;
  startKey: string;
  endKey: string;
  monthsKey?: string;
  daysKey?: string;
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
  /** Currency of the result when it is not the local one (e.g. USD). */
  currency?: string;
  /** The base in another currency and the rate used to bring it to local currency. */
  conversion?: { from: string; amount: number; rate: number };
  /** amount × unit of the configured minimum, and whether it won over the formula. */
  minimum?: number | null;
  minimumApplied?: boolean;
  /** Term dates as YYYY-MM-DD; null when the contract does not fix them. */
  term?: { start: string | null; end: string | null; reason?: string };
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
  return toNumber(rawField(ref, docsByType));
}

/**
 * The text a field reference reads, before it becomes a number (to see its currency or date).
 * Same document choice as validations: the first one (newest first) that has the field.
 */
function rawField(ref: { docType: string; field: string }, docsByType: DocsByTypeLike): unknown {
  const documents = docsByType[ref.docType] ?? [];
  const present = (v: unknown) => Array.isArray(v) ? v.length > 0 : v !== null && v !== undefined && String(v).trim() !== "";
  const raw = (documents.find((document) => present(document.values[ref.field])) ?? documents[0])?.values[ref.field];
  return Array.isArray(raw) ? raw[0] : raw;
}

/** Foreign currency a written amount declares; null for the local one or none. */
export function amountCurrency(value: unknown): string | null {
  const text = String(value ?? "");
  if (/\bUSD\b|US\s?\$|U\$S|d[oó]lar(es)?\b/i.test(text)) return "USD";
  if (/\bEUR\b|€|\beuros?\b/i.test(text)) return "EUR";
  return null;
}

/** YYYY-MM-DD plus months and days; a day that does not exist goes to the month's last one (31 ene + 1 mes = 28/29 feb). */
export function addToDate(iso: string, months: number, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  target.setUTCDate(target.getUTCDate() + days);
  return target.toISOString().slice(0, 10);
}

/** The anchors are matched without accents; the reasons show them as written. */
const ANCHOR_LABEL: Record<string, string> = { suscripcion: "suscripción", terminacion: "terminación" };

const anchorName = (value: string | undefined) => (value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

function termOf(term: CalculationTerm, values: Record<string, string>, docsByType: DocsByTypeLike): NonNullable<CalculationItemResult["term"]> {
  const reasons: string[] = [];
  const dateOf = (key: string) => {
    const name = anchorName(values[key]);
    if (!name || name === "pendiente") { reasons.push("el contrato no dice desde cuándo se cuenta"); return null; }
    const ref = term.anchors[name];
    const date = ref ? normalizeContractDate(rawField(ref, docsByType)) : null;
    if (!date) reasons.push(`el contrato no fija la fecha de ${ANCHOR_LABEL[name] ?? name}`);
    return date;
  };
  const count = (key?: string) => (key ? normalizeContractNumber(values[key]) : null) ?? 0;
  const start = dateOf(term.startKey);
  const endBase = dateOf(term.endKey);
  const end = endBase ? addToDate(endBase, count(term.monthsKey), count(term.daysKey)) : null;
  const unique = [...new Set(reasons)];
  return { start, end, ...(unique.length ? { reason: `Vigencia sin fecha exacta: ${unique.join("; ")}.` } : {}) };
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

const dmy = (iso: string | null) => iso ? iso.split("-").reverse().join("/") : null;

/**
 * What a row of the output document can show besides the model's columns:
 * {{base_calculo}}, {{minimo}}, {{moneda}}, {{tasa_cambio}}, {{vigencia_desde}}, {{vigencia_hasta}}.
 * Only the ones the calculation produces, so an older template keeps its rows.
 */
export function calculationRowExtras(entry: CalculationItemResult): Record<string, unknown> {
  return {
    ...(entry.base !== undefined ? { base_calculo: entry.base } : {}),
    ...(entry.minimum !== undefined ? { minimo: entry.minimum } : {}),
    ...(entry.currency ? { moneda: entry.currency } : {}),
    ...(entry.conversion ? { tasa_cambio: entry.conversion.rate } : {}),
    ...(entry.term ? { vigencia_desde: dmy(entry.term.start), vigencia_hasta: dmy(entry.term.end) } : {}),
  };
}

export type AnalysisCalculationItem ={ values: Record<string, string>; evidence?: string | null };

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
    const formula = formulaText(definition.operation, definition.operand)
      + (definition.minimum ? `, mínimo ${refName(definition.minimum.amount)} × ${refName(definition.minimum.unit)}` : "");
    const itemMode = definition.mode === "each_analysis_item";
    const { operation } = definition;

    if (itemMode) {
      const rawItems = analysisItemsByNode[definition.analysisNodeId ?? ""] ?? [];
      const filtered = definition.itemFilter?.key
        ? rawItems.filter((entry) => entry.values[definition.itemFilter!.key]?.trim().toLowerCase() === definition.itemFilter!.value.trim().toLowerCase())
        : rawItems;
      const factor = 10 ** definition.decimals;
      const round = (value: number) => Math.round((value + Number.EPSILON) * factor) / factor;
      const baseCurrency = definition.base.type === "fixed" ? null : amountCurrency(rawField(definition.base, docsByType));
      const items = filtered.map((entry): CalculationItemResult => {
        let base = resolveReference(definition.base, docsByType, fixed, entry.values);
        const operand = resolveReference(definition.operand, docsByType, fixed, entry.values);
        const term = definition.term ? { term: termOf(definition.term, entry.values, docsByType) } : {};
        const amount = definition.minimum ? resolveReference(definition.minimum.amount, docsByType, fixed, entry.values) : null;
        const unit = definition.minimum ? resolveReference(definition.minimum.unit, docsByType, fixed, entry.values) : null;
        const minimum = amount !== null && unit !== null ? round(amount * unit) : null;
        let currency = baseCurrency ?? undefined;
        let conversion: CalculationItemResult["conversion"];
        // A minimum in local currency cannot be compared with a base in dollars
        // until the base is converted; without a rate the item stays for review.
        if (minimum !== null && baseCurrency && base !== null) {
          const rateKey = definition.currency?.rates.find((rate) => rate.code === baseCurrency)?.fixedKey;
          const rate = rateKey ? fixed.get(rateKey) ?? null : null;
          if (rate === null) {
            return { values: entry.values, evidence: entry.evidence, base, operand, currency, minimum, ...term, value: null, status: "missing",
              reason: `El valor del contrato está en ${baseCurrency} y el mínimo en pesos: falta la tasa de cambio en el cálculo para compararlos.` };
          }
          conversion = { from: baseCurrency, amount: base, rate };
          base = base * rate;
          currency = undefined;
        }
        const sides = { values: entry.values, evidence: entry.evidence, base, operand, ...(currency ? { currency } : {}), ...(conversion ? { conversion } : {}), ...term };
        if (base === null || operand === null) {
          return { ...sides, value: null, status: "missing", reason: "Falta un valor de la fórmula en este elemento." };
        }
        const result = apply(base, operation, operand);
        if (result === null) return { ...sides, value: null, status: "error", reason: "No es posible dividir entre cero." };
        const value = round(result);
        if (minimum === null) return { ...sides, value, status: "ok" };
        return { ...sides, value: Math.max(value, minimum), status: "ok", minimum, minimumApplied: minimum > value };
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
