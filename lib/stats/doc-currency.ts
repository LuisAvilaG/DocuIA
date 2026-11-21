// The currency of a document's total, for sums. Amounts of different
// currencies are never added together: every total is given per currency.
import { sql, type SQL } from "drizzle-orm";
import { historyDocuments, subsidiaries } from "@/db/schema";

export interface CurrencyAmount { currency: string; amount: number }

const isoCode = (value: SQL) => sql`case when upper(${value}) ~ '^[A-Z]{3}$' then upper(${value}) end`;

/**
 * The currency read from the document (kept in metrics_json, because products
 * is replaced by the posted lines once the document goes to the ERP), else its
 * subsidiary's. The query must join `subsidiaries` on the document's subsidiary.
 */
export const docCurrency = sql<string>`coalesce(
  ${isoCode(sql`${historyDocuments.metricsJson}->>'currency'`)},
  ${isoCode(sql`${historyDocuments.products}->'document'->>'currency'`)},
  ${subsidiaries.currency}, '')`;

/** Rows of (currency, amount) as a list without empty amounts, largest first. */
export function amountsByCurrency(rows: Array<{ currency: string | null; amount: number | string | null }>): CurrencyAmount[] {
  const sums = new Map<string, number>();
  for (const row of rows) sums.set(row.currency ?? "", (sums.get(row.currency ?? "") ?? 0) + Number(row.amount ?? 0));
  return [...sums.entries()].filter(([, amount]) => amount !== 0).map(([currency, amount]) => ({ currency, amount })).sort((a, b) => b.amount - a.amount);
}
