import assert from "node:assert/strict";
import { test } from "node:test";
import { INVOICE_SCHEMA, configuredModel, mapInvoice, secondaryReason } from "../lib/workflow/extract";
import { toGeminiSchema } from "../lib/ai/provider";
import type { ExtractedInvoice } from "../lib/workflow/types";

const base = (over: Partial<ExtractedInvoice> = {}): ExtractedInvoice => ({
  format: "general", vendor: "Sysco", invoiceNumber: "341960391", invoiceDate: "24.01.2026", dueDate: "", purchaseOrder: "", currency: "USD",
  subtotal: 100, tax: null, total: 100, uncertainFields: [],
  lines: [{ description: "Cheese", quantity: 1, rate: 60, amount: 60, uom: "CS", itemCode: "1" }, { description: "Fuel", quantity: null, rate: null, amount: 40, uom: null, itemCode: null, lineType: "charge" }],
  ...over,
});

test("a consistent first result needs no second model", () => {
  assert.equal(secondaryReason(base()), null);
});

test("evidence sends the document to the second model: no lines, totals off, header missing, model doubt", () => {
  assert.equal(secondaryReason(base({ lines: [] })), "sin líneas");
  assert.match(secondaryReason(base({ total: 150 })) ?? "", /no cuadran/);
  assert.equal(secondaryReason(base({ invoiceNumber: "", total: null })), "sin número ni total");
  assert.equal(secondaryReason(base({ vendor: "" })), "sin proveedor");
  assert.match(secondaryReason(base({ uncertainFields: [{ field: "total", reason: "faint", header: true }] })) ?? "", /duda de total/);
  assert.equal(secondaryReason(base({ uncertainFields: [{ field: "lines[3].amount", reason: "faint", header: false }] })), null);
});

test("each evidence rule can be switched off", () => {
  assert.equal(secondaryReason(base({ lines: [] }), {}, { onZeroLines: false }), null);
  assert.equal(secondaryReason(base({ total: 150 }), {}, { onTotalMismatch: false }), null);
});

test("the mapper reads the new line fields and keeps older key names working", () => {
  const invoice = mapInvoice({
    vendor: "Sysco", vendor_tax_id: "12-345", invoice_number: "1", invoice_date: "2026-01-24", delivery_date: "2026-01-25", due_date: null, currency: "usd", total: 57.45,
    lines: [
      { line_type: "item", description: "Pepperoni", supplier_item_code: "1064922", other_item_code: "37648", quantity: 8.84, uom: "LB", billed_weight: 8.84, weight_uom: "LB", rate: 6.499, amount: 57.45, bbox: { page: 1, x1: 0.1, y1: 0.5, x2: 0.9, y2: 0.52 } },
      { description: "Legacy", item_code: "X1", quantity: 1, rate: 2, amount: 2 },
      { line_type: "charge", description: "Fuel surcharge", amount: 6.5 },
    ],
    uncertain_fields: [{ field: "total", reason: "handwritten mark over the figure" }, { field: "lines[0].rate", reason: "faint" }, { field: "" }],
  }, "sysco.pdf");
  assert.equal(invoice.vendorRfc, "12-345");
  assert.equal(invoice.invoiceDate, "24.01.2026");
  assert.equal(invoice.deliveryDate, "25.01.2026");
  assert.equal(invoice.currency, "USD");
  assert.equal(invoice.lines.length, 3);
  assert.deepEqual([invoice.lines[0].itemCode, invoice.lines[0].otherItemCode, invoice.lines[0].billedWeight, invoice.lines[0].weightUom], ["1064922", "37648", 8.84, "LB"]);
  assert.equal(invoice.lines[1].itemCode, "X1");
  assert.equal(invoice.lines[2].lineType, "charge");
  assert.deepEqual(invoice.uncertainFields.map((f) => [f.field, f.header]), [["total", true], ["lines[0].rate", false]]);
});

test("a delivery-dated invoice posts on its delivery date, flagged for the reviewer", () => {
  const invoice = mapInvoice({ vendor: "Sysco", invoice_number: "1", invoice_date: null, delivery_date: "2026-01-24", total: 10, lines: [], uncertain_fields: [] }, "x.pdf");
  assert.equal(invoice.invoiceDate, "24.01.2026");
  assert.deepEqual(invoice.uncertainFields, [{ field: "invoice_date", reason: "tomada de la fecha de entrega", header: true }]);
  const dated = mapInvoice({ vendor: "Sysco", invoice_number: "1", invoice_date: "2026-01-20", delivery_date: "2026-01-24", total: 10, lines: [], uncertain_fields: [] }, "x.pdf");
  assert.equal(dated.invoiceDate, "20.01.2026");
  assert.equal(dated.uncertainFields.length, 0);
});

test("models from either provider are accepted; unknown ids fall back", () => {
  assert.equal(configuredModel("gemini-2.5-flash", "claude-haiku-5-5"), "gemini-2.5-flash");
  assert.equal(configuredModel("claude-sonnet-5-5", "claude-haiku-5-5"), "claude-sonnet-5-5");
  assert.equal(configuredModel("gpt-9", "claude-haiku-5-5"), "claude-haiku-5-5");
});

test("the invoice schema converts to Gemini's dialect", () => {
  const gemini = toGeminiSchema(INVOICE_SCHEMA) as { type: string; properties: Record<string, { type: string; nullable?: boolean; items?: { properties: Record<string, { enum?: string[] }> } }>; propertyOrdering: string[] };
  assert.equal(gemini.type, "OBJECT");
  assert.equal(gemini.properties.total.type, "NUMBER");
  assert.equal(gemini.properties.total.nullable, true);
  assert.equal(gemini.properties.lines.type, "ARRAY");
  assert.deepEqual(gemini.properties.lines.items?.properties.line_type.enum, ["item", "charge"]);
  assert.ok(gemini.propertyOrdering.includes("uncertain_fields"));
  assert.ok(!("additionalProperties" in gemini));
});
