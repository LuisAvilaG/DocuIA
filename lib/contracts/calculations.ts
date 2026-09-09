export const CALCULATION_OPERATIONS = ["percentage", "multiply", "add", "subtract", "divide"] as const;
export type CalculationOperation = typeof CALCULATION_OPERATIONS[number];

export interface CalculationDefinition {
  key: string;
  label: string;
  base: { docType: string; field: string };
  operation: CalculationOperation;
  operand: number;
  decimals: number;
}

export interface CalculationResult {
  key: string;
  label: string;
  value: number | null;
  status: "ok" | "missing" | "error";
  formula: string;
  sourceValue: number | null;
  reason?: string;
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

function formulaText(operation: CalculationOperation, operand: number): string {
  if (operation === "percentage") return `base × ${operand}%`;
  if (operation === "multiply") return `base × ${operand}`;
  if (operation === "add") return `base + ${operand}`;
  if (operation === "subtract") return `base − ${operand}`;
  return `base ÷ ${operand}`;
}

function apply(base: number, operation: CalculationOperation, operand: number): number | null {
  if (operation === "percentage") return base * operand / 100;
  if (operation === "multiply") return base * operand;
  if (operation === "add") return base + operand;
  if (operation === "subtract") return base - operand;
  return operand === 0 ? null : base / operand;
}

/** Executes deterministic flow calculations after extraction, before output generation. */
export function evaluateCalculations(definitions: CalculationDefinition[], docsByType: DocsByTypeLike): CalculationResult[] {
  return definitions.map((definition) => {
    const documents = docsByType[definition.base.docType] ?? [];
    const raw = documents.at(-1)?.values[definition.base.field];
    const base = toNumber(Array.isArray(raw) ? raw[0] : raw);
    const formula = formulaText(definition.operation, definition.operand);
    if (base === null) {
      return { key: definition.key, label: definition.label, value: null, status: "missing", sourceValue: null, formula, reason: `No se encontró un número en ${definition.base.field}.` };
    }
    const value = apply(base, definition.operation, definition.operand);
    if (value === null) {
      return { key: definition.key, label: definition.label, value: null, status: "error", sourceValue: base, formula, reason: "No es posible dividir entre cero." };
    }
    const factor = 10 ** definition.decimals;
    return { key: definition.key, label: definition.label, value: Math.round((value + Number.EPSILON) * factor) / factor, status: "ok", sourceValue: base, formula };
  });
}
