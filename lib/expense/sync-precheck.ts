// What every line of a report needs before it can be posted to NetSuite.
// Pure, so the same rules run when the employee sends the report (while it can
// still be edited) and again right before the sync.

export interface PrecheckItem {
  lineNumber: number;
  nsRecordType: string | null;
  currency: string | null;
  vendorNit: string | null;
  invoiceNumber: string | null;
  needsDocumentoEquivalente: boolean | null;
  invoiceDate: Date | string | null;
  expenseDate: Date | string | null;
  category: { netsuiteCategoryId: string | null; netsuiteAccountId: string | null } | null;
}

export function expenseItemProblems(items: PrecheckItem[]): string[] {
  const problems: string[] = [];
  const personal = items.filter((item) => item.nsRecordType === "expense_report");
  const vendorBills = items.filter((item) => item.nsRecordType === "vendor_bill");

  // Personal (Expense Report) lines need the NetSuite expense category.
  for (const item of personal) {
    if (!item.category?.netsuiteCategoryId) {
      problems.push(`Línea ${item.lineNumber}: sin categoría de NetSuite (re-sincroniza catálogos)`);
    }
  }

  // The Expense Report is posted without a currency per line, so NetSuite books
  // every amount in the report's currency. Mixed currencies would post a
  // USD 100 line as 100 of whatever the others are.
  const currencies = [...new Set(personal.map((item) => (item.currency ?? "").toUpperCase()).filter(Boolean))];
  if (currencies.length > 1) {
    problems.push(
      `El informe mezcla monedas (${currencies.join(", ")}) en gastos personales y NetSuite los registraría todos en una sola. ` +
      `Deja una sola moneda por informe o convierte los importes.`
    );
  }

  // Vendor Bill lines need the vendor's tax id, a reference (a documento
  // equivalente receives a deterministic one) and the category's GL account:
  // the expense line on the bill is account-based, not item-based.
  for (const item of vendorBills) {
    if (!item.vendorNit) problems.push(`Línea ${item.lineNumber}: Vendor Bill requiere NIT/RFC del proveedor`);
    if (!item.invoiceNumber && !item.needsDocumentoEquivalente) problems.push(`Línea ${item.lineNumber}: Vendor Bill requiere número de factura`);
    if (!item.category?.netsuiteAccountId) problems.push(`Línea ${item.lineNumber}: la categoría no tiene cuenta contable de NetSuite (re-sincroniza catálogos)`);
    // Without a date the bill was posted with the day of the sync, unnoticed.
    if (!item.invoiceDate && !item.expenseDate) problems.push(`Línea ${item.lineNumber}: falta la fecha del comprobante (se registra como factura de proveedor y necesita su fecha)`);
  }
  return problems;
}
