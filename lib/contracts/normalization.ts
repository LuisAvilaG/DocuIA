export type ComparisonNormalizer = "auto" | "date" | "number" | "name" | "text";

const DATE_FIELD_RE = /(date|fecha|vigenc|vencim|expir|expiry|start|end|inicio|termin)/i;
const NUMBER_FIELD_RE = /(amount|monto|sum|suma|premium|prima|total|valor|value|price|precio|deducible|deductible|limit|limite|l[ií]mite)/i;

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
  const compact = raw.replace(/,/g, "").replace(/\s+/g, " ");

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
  const raw = cleanText(value);
  if (!raw) return null;
  const minus = raw.includes("-") ? -1 : 1;
  const numeric = raw.replace(/[^\d.,]/g, "");
  if (!/\d/.test(numeric)) return null;
  const groupsAsThousands = /^\d{1,3}([.,]\d{3})+$/.test(numeric);
  if (groupsAsThousands) return minus * Number(numeric.replace(/[.,]/g, ""));

  const lastDot = numeric.lastIndexOf(".");
  const lastComma = numeric.lastIndexOf(",");
  const decimalAt = Math.max(lastDot, lastComma);
  if (decimalAt === -1) return minus * Number(numeric);

  const fraction = numeric.slice(decimalAt + 1).replace(/[.,]/g, "");
  // One or two digits at the end conventionally denotes cents. Three digits
  // are treated as a grouping separator so "$21.008" stays twenty-one thousand.
  if (fraction.length > 0 && fraction.length <= 2) {
    const whole = numeric.slice(0, decimalAt).replace(/[.,]/g, "");
    return minus * Number(`${whole}.${fraction}`);
  }
  return minus * Number(numeric.replace(/[.,]/g, ""));
}

export function normalizeContractText(value: unknown): string {
  return normalizeWord(cleanText(value)).replace(/[^a-z0-9]+/g, " ").trim();
}

export function textValuesMatch(left: unknown, right: unknown): boolean {
  const a = normalizeContractText(left);
  const b = normalizeContractText(right);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const wordsA = a.split(" ").filter((word) => word.length >= 2);
  const wordsB = b.split(" ").filter((word) => word.length >= 2);
  if (!wordsA.length || !wordsB.length) return false;
  const [short, long] = wordsA.length <= wordsB.length ? [wordsA, wordsB] : [wordsB, wordsA];
  const longSet = new Set(long);
  const matches = short.filter((word) => longSet.has(word)).length;
  return matches >= 2 && matches / short.length >= 0.6;
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
  if (normalizer === "number" || (normalizer === "auto" && numberLeft !== null && numberRight !== null && (NUMBER_FIELD_RE.test(fieldNames) || (looksLikeNumber(input.left) && looksLikeNumber(input.right))))) {
    return numberLeft !== null && numberRight !== null && Math.abs(numberLeft - numberRight) <= (input.numericTolerance ?? 0);
  }
  // "name" deliberately shares the tolerant textual comparator. It is kept as
  // an explicit rule option so a flow tells reviewers how the field is read.
  return textValuesMatch(input.left, input.right);
}
