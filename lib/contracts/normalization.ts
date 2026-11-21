import { parseLocaleNumber } from "@/lib/numbers";
export type ComparisonNormalizer = "auto" | "date" | "number" | "identifier" | "name" | "text";

const DATE_FIELD_RE = /(date|fecha|vigenc|vencim|expir|expiry|start|end|inicio|termin)/i;
const NUMBER_FIELD_RE = /(amount|monto|sum|suma|premium|prima|total|valor|value|price|precio|deducible|deductible|limit|limite|l[ií]mite)/i;
// Tax IDs are identifiers, not amounts. A NIT such as 860.505.064-1 must
// match the same ID written as 8605050641, without treating the hyphen as a
// negative sign or a formatting difference as a mismatch.
// Whole words only: "valor_bruto", "precio_unitario" and "construccion" contain
// "rut", "nit" and "ruc" but are not tax IDs.
const IDENTIFIER_FIELD_RE = /(?:^|[ _.-])(nit|tax[ _-]?id|ruc|rut|cuit|cuil|rfc|identif[a-zó]*|id[ _-]?fiscal)(?=$|[ _.-])/;
const isIdentifierField = (fieldNames: string) => IDENTIFIER_FIELD_RE.test(fieldNames.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase());

const MONTHS: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10,
  noviembre: 11, diciembre: 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

function cleanText(value: unknown): string {
  return String(value ?? "").replace(/\u00a0/g, " ").trim();
}

function normalizeWord(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function asIsoDate(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

/** Converts familiar Latin-American and English document dates to YYYY-MM-DD. */
export function normalizeContractDate(value: unknown): string | null {
  const raw = cleanText(value);
  if (!raw) return null;
  const compact = raw
    .replace(/^(\d{4}-\d{2}-\d{2})[T ]\d{2}:\d{2}.*$/, "$1")   // ISO date with a time
    .replace(/,/g, "").replace(/[°º]/g, "")                       // "1° de marzo"
    .replace(/\bdel\b/gi, "de")                                  // "16 de mayo del 2025"
    .replace(/\s+/g, " ").replace(/[\s.]+$/, "").trim();          // trailing period

  let match = compact.match(/^(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})$/);
  if (match) return asIsoDate(Number(match[1]), Number(match[2]), Number(match[3]));

  // Contract tenants are LATAM-first: 16/05/2025 means 16 May, not 5 June.
  match = compact.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);
  if (match) return asIsoDate(Number(match[3]), Number(match[2]), Number(match[1]));

  const lowered = normalizeWord(compact);
  match = lowered.match(/^(?:el\s+)?(\d{1,2})\s+(?:de\s+)?([a-z]+)\s+(?:de\s+)?(\d{4})$/);
  if (match && MONTHS[match[2]]) return asIsoDate(Number(match[3]), MONTHS[match[2]], Number(match[1]));

  match = lowered.match(/^([a-z]+)\s+(\d{1,2})\s+(\d{4})$/);
  if (match && MONTHS[match[1]]) return asIsoDate(Number(match[3]), MONTHS[match[1]], Number(match[2]));

  return null;
}

/** Parses document amounts independently from decimal/thousands separator style. */
export function normalizeContractNumber(value: unknown): number | null {
  if (typeof value === "number") return parseLocaleNumber(value);
  // "1 500 000" is one figure written with spaces.
  const text = cleanText(value).replace(/(\d) (?=\d{3}(?:\D|$))/g, "$1");
  // One figure only. The parser keeps every digit of the text, so a value such
  // as "$58.833.600 más IVA 19%" or "24 meses (2 años)" came out as a number
  // nobody wrote. With more than one figure there is no telling which is meant.
  if ((text.match(/\d[\d.,]*/g) ?? []).length > 1) return null;
  return parseLocaleNumber(text);
}

export function normalizeContractText(value: unknown): string {
  return normalizeWord(cleanText(value)).replace(/[^a-z0-9]+/g, " ").trim();
}

/** Removes visual punctuation from fiscal and document identifiers. */
export function normalizeContractIdentifier(value: unknown): string {
  return cleanText(value).normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// Company-form words that one document writes and another leaves out.
const LEGAL_FORM = new Set(["sa", "sas", "ltda", "limitada", "srl", "sl", "sc", "cv", "inc", "corp", "llc", "ltd", "spa", "eirl", "cia"]);

/**
 * The same name or text written two ways: word order, accents and a missing
 * second name or company form do not matter. Every word of the shorter text
 * must be in the longer one: sharing most words is not enough ("María José
 * Pérez" is not "María José Soto"), and neither is one text being the start of
 * the other ("CT-12" is not "CT-123").
 */
export function textValuesMatch(left: unknown, right: unknown): boolean {
  const a = normalizeContractText(left);
  const b = normalizeContractText(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const words = (text: string) => {
    const all = text.split(" ").filter((word) => word.length >= 2);
    const core = all.filter((word) => !LEGAL_FORM.has(word));
    return core.length ? core : all;
  };
  const wordsA = words(a);
  const wordsB = words(b);
  if (!wordsA.length || !wordsB.length) return false;
  const [short, long] = wordsA.length <= wordsB.length ? [wordsA, wordsB] : [wordsB, wordsA];
  const longSet = new Set(long);
  if (!short.every((word) => longSet.has(word))) return false;
  // A single word in common only counts when it is the whole of both texts.
  return short.length >= 2 || long.length === 1;
}

function looksLikeNumber(value: unknown): boolean {
  const raw = cleanText(value);
  return /^[^a-záéíóúñ]*\d[^a-záéíóúñ]*$/i.test(raw);
}

export function compareContractValues(input: {
  left: unknown;
  right: unknown;
  leftField: string;
  rightField: string;
  normalizer?: ComparisonNormalizer;
  numericTolerance?: number;
}): boolean {
  const normalizer = input.normalizer ?? "auto";
  const dateLeft = normalizeContractDate(input.left);
  const dateRight = normalizeContractDate(input.right);
  const numberLeft = normalizeContractNumber(input.left);
  const numberRight = normalizeContractNumber(input.right);
  const fieldNames = `${input.leftField} ${input.rightField}`;

  if (normalizer === "date" || (normalizer === "auto" && dateLeft !== null && dateRight !== null && DATE_FIELD_RE.test(fieldNames))) {
    return dateLeft !== null && dateRight !== null && dateLeft === dateRight;
  }
  if (normalizer === "identifier" || (normalizer === "auto" && isIdentifierField(fieldNames))) {
    const identifierLeft = normalizeContractIdentifier(input.left);
    const identifierRight = normalizeContractIdentifier(input.right);
    return Boolean(identifierLeft && identifierRight && identifierLeft === identifierRight);
  }
  if (normalizer === "number" || (normalizer === "auto" && numberLeft !== null && numberRight !== null && (NUMBER_FIELD_RE.test(fieldNames) || (looksLikeNumber(input.left) && looksLikeNumber(input.right))))) {
    return numberLeft !== null && numberRight !== null && Math.abs(numberLeft - numberRight) <= (input.numericTolerance ?? 0);
  }
  // "name" deliberately shares the tolerant textual comparator. It is kept as
  // an explicit rule option so a flow tells reviewers how the field is read.
  return textValuesMatch(input.left, input.right);
}
