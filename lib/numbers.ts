/**
 * Parses an amount written in any common Latin American or US format and
 * detects the decimal separator per value, because a single tenant receives
 * contracts and receipts written both ways:
 *   "1.500.000,00" → 1500000   "1,234.56" → 1234.56   "4.603.482.380" → 4603482380
 *   "150.000" → 150000         "12,5" → 12.5          "0,125" → 0.125
 *
 * Rules: with both separators, the last one is the decimal mark. With one kind
 * repeated, it groups thousands. A single separator is decimal unless exactly
 * three digits follow a non-zero integer part ("150.000", "21.008"), which is
 * how thousands are written in contract amounts.
 */
export function parseLocaleNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const raw = value.replace(/ /g, " ").trim();
  if (!raw) return null;
  // Only a leading hyphen denotes a negative amount; inner hyphens belong to
  // identifiers and ranges.
  const sign = /^[\s($]*-/.test(raw) ? -1 : 1;
  const numeric = raw.replace(/[^\d.,]/g, "");
  if (!/\d/.test(numeric)) return null;

  const lastDot = numeric.lastIndexOf(".");
  const lastComma = numeric.lastIndexOf(",");
  let normalized: string;

  if (lastDot >= 0 && lastComma >= 0) {
    const [whole, fraction] = splitAt(numeric, Math.max(lastDot, lastComma));
    normalized = `${stripSeparators(whole)}.${fraction}`;
  } else {
    const separator = lastDot >= 0 ? "." : lastComma >= 0 ? "," : "";
    const count = separator ? numeric.split(separator).length - 1 : 0;
    if (!separator) {
      normalized = numeric;
    } else if (count > 1) {
      normalized = stripSeparators(numeric);
    } else {
      const [whole, fraction] = splitAt(numeric, numeric.lastIndexOf(separator));
      const groupsThousands = fraction.length === 3 && /[1-9]/.test(whole);
      normalized = groupsThousands ? `${whole}${fraction}` : `${whole || "0"}.${fraction}`;
    }
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? sign * parsed : null;
}

function splitAt(value: string, index: number): [string, string] {
  return [value.slice(0, index), value.slice(index + 1)];
}

function stripSeparators(value: string): string {
  return value.replace(/[.,]/g, "");
}
