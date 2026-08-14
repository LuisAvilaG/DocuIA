import type { ExtractedInvoice } from "./types";

export interface ExtractionValidationConfig {
  hard_fail_abs_diff?: number;
  hard_fail_pct?: number;
  tolerance_abs?: number;
  tolerance_pct?: number;
}

export type ExtractionValidationResult =
  | { level: "skipped" | "ok" }
  | { level: "warning"; difference: number; percentage: number }
  | { level: "error"; difference: number; percentage: number };

function positiveNumber(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

/**
 * Verifies that the extracted header total is consistent with its line items.
 * A material discrepancy must exceed both the absolute and percentage limits;
 * this avoids rejecting a large invoice over harmless rounding differences.
 */
export function validateExtraction(
  invoice: ExtractedInvoice,
  config: ExtractionValidationConfig,
): ExtractionValidationResult {
  if (invoice.total === null || !invoice.lines.length) return { level: "skipped" };

  const lineTotal = invoice.lines.reduce((sum, line) => {
    const amount = line.amount ?? (
      line.quantity !== null && line.rate !== null ? line.quantity * line.rate : null
    );
    return sum + (amount ?? 0);
  }, 0);
  if (!Number.isFinite(lineTotal)) return { level: "skipped" };

  // Invoice lines usually sum to the subtotal. When tax was extracted, compare
  // the header total to subtotal + tax instead of flagging every taxable bill.
  const expectedTotal = lineTotal + (invoice.tax ?? 0);
  const difference = Math.abs(invoice.total - expectedTotal);
  const percentage = difference / Math.max(Math.abs(invoice.total), Math.abs(expectedTotal), 1);
  const toleranceAbs = positiveNumber(config.tolerance_abs, 0.5);
  const tolerancePct = positiveNumber(config.tolerance_pct, 0.01);
  const hardFailAbs = positiveNumber(config.hard_fail_abs_diff, 5);
  const hardFailPct = positiveNumber(config.hard_fail_pct, 0.02);

  if (difference <= toleranceAbs || percentage <= tolerancePct) return { level: "ok" };
  if (difference > hardFailAbs && percentage > hardFailPct) {
    return { level: "error", difference, percentage };
  }
  return { level: "warning", difference, percentage };
}
