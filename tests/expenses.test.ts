import test from "node:test";
import assert from "node:assert/strict";
import { createExpenseItemSchema, expenseRecordType, resolveAmounts, updateExpenseItemSchema } from "../lib/expense/item-input";
import { validateExpenseAmounts } from "../lib/expense/tax-engine";
import { nitCandidates } from "../lib/expense/nit";

const reportId = "10000000-0000-4000-8000-000000000009";

test("an item without category or subtotal is valid; subtotal is derived", () => {
  const parsed = createExpenseItemSchema.safeParse({ reportId, total: 119000, taxAmount: 19000, categoryId: null, paymentMethod: "personal" });
  assert.equal(parsed.success, true);
  const amounts = resolveAmounts(parsed.success ? parsed.data : { total: 0 });
  assert.deepEqual(amounts, { subtotal: 100000, taxAmount: 19000, retentionAmount: 0, total: 119000 });
  assert.equal(validateExpenseAmounts(amounts).ok, true);
});

test("typed Colombian amounts are not read as decimals", () => {
  const parsed = createExpenseItemSchema.parse({ reportId, total: "150.000", paymentMethod: "personal" });
  assert.equal(parsed.total, 150000);
});

test("bad input is a validation error, not a database error", () => {
  const bad = [
    { reportId, total: 10, paymentMethod: "personal", categoryId: 0 },
    { reportId, total: 10, paymentMethod: "personal", currency: "PESOS" },
    { reportId, total: 10, paymentMethod: "personal", vendorNit: "9".repeat(60) },
    { reportId, total: 10, paymentMethod: "personal", invoiceDate: "ayer" },
    { reportId, total: "abc", paymentMethod: "personal" },
    { reportId: "x", total: 10, paymentMethod: "personal" },
  ];
  for (const body of bad) assert.equal(createExpenseItemSchema.safeParse(body).success, false, JSON.stringify(body));
  assert.equal(updateExpenseItemSchema.safeParse({ organizationId: "other" }).success, false, "unknown fields are rejected");
});

test("dates become Date objects for timestamp columns", () => {
  const parsed = updateExpenseItemSchema.parse({ expenseDate: "2026-09-01" });
  assert.ok(parsed.expenseDate instanceof Date);
});

test("company-paid invoices become vendor bills", () => {
  assert.equal(expenseRecordType("company_pays_vendor", "invoice", false), "vendor_bill");
  assert.equal(expenseRecordType("personal", "invoice", false), "expense_report");
  assert.equal(expenseRecordType("company_pays_vendor", "receipt", true), "vendor_bill");
});

test("NIT lookup candidates match exactly, with or without check digit", () => {
  assert.deepEqual(nitCandidates("900.123.456-7").sort(), ["900123456", "900123456-7", "9001234567"].sort());
  assert.deepEqual(nitCandidates("9001"), ["9001"]);
  assert.ok(nitCandidates("1'; DROP--").every((c) => /^[0-9A-Z-]+$/.test(c)));
});
