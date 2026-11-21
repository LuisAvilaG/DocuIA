// Amounts in different currencies are never added together: a report total is
// one figure per currency ("$ 120.000 + US$ 45").

export function expenseTotalsByCurrency(items: Array<{ total: string | null; currency?: string | null }>): Array<{ currency: string; total: number }> {
  const totals = new Map<string, number>();
  for (const item of items) {
    const currency = (item.currency || "COP").toUpperCase();
    totals.set(currency, (totals.get(currency) ?? 0) + (parseFloat(item.total ?? "0") || 0));
  }
  return [...totals].map(([currency, total]) => ({ currency, total }));
}

export function formatExpenseTotals(items: Array<{ total: string | null; currency?: string | null }>): string {
  const totals = expenseTotalsByCurrency(items);
  if (!totals.length) totals.push({ currency: "COP", total: 0 });
  return totals.map(({ currency, total }) => formatExpenseAmount(total, currency)).join(" + ");
}

// Pesos are written without cents; other currencies keep theirs when they have any.
const NO_CENTS = new Set(["COP", "CLP", "PYG"]);

export function formatExpenseAmount(amount: number, currency: string): string {
  const maximumFractionDigits = NO_CENTS.has(currency) ? 0 : 2;
  const minimumFractionDigits = maximumFractionDigits && !Number.isInteger(amount) ? 2 : 0;
  try {
    return amount.toLocaleString("es-CO", { style: "currency", currency, minimumFractionDigits, maximumFractionDigits });
  } catch {
    // Not an ISO 4217 code Intl knows how to format.
    return `${amount.toLocaleString("es-CO", { minimumFractionDigits, maximumFractionDigits })} ${currency}`;
  }
}
