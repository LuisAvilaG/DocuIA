import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PO_MATCH_CONFIG, autoSelectedPo, comparePoLines, parsePoMatchConfig, poOutcome, suggestPurchaseOrders,
  totalWithinTolerance, type InvoiceLineInput,
} from "../lib/workflow/po-match";
import { parseVendorRuleConfig, resolveVendorRule, type VendorRuleConfig } from "../lib/workflow/vendor-rules";
import type { NSPurchaseOrderDetail } from "../lib/netsuite/client";

const open = [
  { internal_id: "11", tranid: "OC-1043", date: "12/9/2026", total: "12500.00", currency: "MXN", status: "Pending Bill" },
  { internal_id: "12", tranid: "OC-1051", date: "18/9/2026", total: "12470.00", currency: "MXN", status: "Pending Bill" },
  { internal_id: "13", tranid: "OC-0990", date: "01/8/2026", total: "3000.00", currency: "MXN", status: "Pending Bill" },
];

test("the PO cited on the invoice ranks first and is preselected", () => {
  const s = suggestPurchaseOrders({ poNumber: "PO 1043", total: 12480 }, open, DEFAULT_PO_MATCH_CONFIG);
  assert.deepEqual(s.map((x) => [x.tranid, x.reason]), [["OC-1043", "number"], ["OC-1051", "total"]]);
  assert.equal(s[0].difference, -20);
  assert.equal(autoSelectedPo(s, DEFAULT_PO_MATCH_CONFIG)?.tranid, "OC-1043");
});

test("without a cited number, only a single total match is preselected", () => {
  const two = suggestPurchaseOrders({ poNumber: null, total: 12480 }, open, DEFAULT_PO_MATCH_CONFIG);
  assert.equal(two.length, 2);
  assert.equal(autoSelectedPo(two, DEFAULT_PO_MATCH_CONFIG), null);
  const one = suggestPurchaseOrders({ poNumber: null, total: 3010 }, open, DEFAULT_PO_MATCH_CONFIG);
  assert.equal(autoSelectedPo(one, DEFAULT_PO_MATCH_CONFIG)?.tranid, "OC-0990");
});

test("total tolerance: exact, percent and fixed amount", () => {
  assert.equal(totalWithinTolerance(100, 100, { totalToleranceType: "exact", totalToleranceValue: 0 }), true);
  assert.equal(totalWithinTolerance(100.5, 100, { totalToleranceType: "exact", totalToleranceValue: 0 }), false);
  assert.equal(totalWithinTolerance(101, 100, { totalToleranceType: "percent", totalToleranceValue: 1 }), true);
  assert.equal(totalWithinTolerance(102, 100, { totalToleranceType: "percent", totalToleranceValue: 1 }), false);
  assert.equal(totalWithinTolerance(150, 100, { totalToleranceType: "amount", totalToleranceValue: 50 }), true);
});

const po: NSPurchaseOrderDetail = {
  internal_id: "11", tranid: "OC-1043", date: "12/9/2026", total: 12500, currency: "MXN",
  lines: [
    { line: "1", item_internal_id: "A", item_name: "Cheddar", description: "", quantity: 20, quantity_received: 20, quantity_billed: 0, rate: 185, amount: 3700, units: "", closed: false },
    { line: "2", item_internal_id: "B", item_name: "Mozzarella", description: "", quantity: 12, quantity_received: 12, quantity_billed: 0, rate: 210, amount: 2520, units: "", closed: false },
    { line: "3", item_internal_id: "C", item_name: "Crema", description: "", quantity: 30, quantity_received: 18, quantity_billed: 0, rate: 96, amount: 2880, units: "", closed: false },
  ],
};

const lines: InvoiceLineInput[] = [
  { index: 0, description: "Cheddar", itemId: "A", quantity: 20, rate: 185, amount: 3700 },
  { index: 1, description: "Mozzarella", itemId: "B", quantity: 12, rate: 212.5, amount: 2550 },
  { index: 2, description: "Crema", itemId: "C", quantity: 30, rate: 96, amount: 2880 },
  { index: 3, description: "Flete", itemId: "Z", quantity: 1, rate: 450, amount: 450 },
];

test("line comparison flags price, receipt and lines outside the PO", () => {
  const cmp = comparePoLines(lines, po, DEFAULT_PO_MATCH_CONFIG, { requireReceipt: true, invoiceTotal: 12480 });
  assert.deepEqual(cmp.lines.map((l) => l.status), ["match", "price_within_tolerance", "not_received", "not_in_po"]);
  assert.equal(cmp.lines[2].missingReceipt, 12);
  assert.equal(cmp.totalWithinTolerance, true);
  const outcome = poOutcome(cmp, DEFAULT_PO_MATCH_CONFIG);
  assert.equal(outcome.kind, "await_receipt");
});

test("without the 3-way match, missing receipts do not stop the invoice", () => {
  const cmp = comparePoLines(lines.slice(0, 3), po, DEFAULT_PO_MATCH_CONFIG, { requireReceipt: false, invoiceTotal: 9130 });
  assert.equal(cmp.counts.not_received, 0);
  assert.equal(poOutcome(cmp, DEFAULT_PO_MATCH_CONFIG).kind, "ok");
});

test("a partial invoice is compared with the PO value of the lines it covers", () => {
  // One delivery of a larger PO: 20 of Cheddar at the PO price, invoice total with VAT.
  const cmp = comparePoLines([lines[0]], po, DEFAULT_PO_MATCH_CONFIG, { requireReceipt: true, invoiceTotal: 4292 });
  assert.equal(cmp.poTotal, 3700);
  assert.equal(cmp.invoiceTotal, 3700);
  assert.equal(cmp.totalWithinTolerance, true);
  assert.equal(poOutcome(cmp, DEFAULT_PO_MATCH_CONFIG).kind, "ok");
});

test("price out of tolerance follows the configured action", () => {
  const pricey = [{ ...lines[0], rate: 200 }];
  const cmp = comparePoLines(pricey, po, DEFAULT_PO_MATCH_CONFIG, { requireReceipt: false, invoiceTotal: 12500 });
  assert.equal(cmp.lines[0].status, "price_mismatch");
  assert.equal(poOutcome(cmp, { onMismatch: "block", extraLines: "warn" }).kind, "blocked");
  assert.equal(poOutcome(cmp, { onMismatch: "approval", extraLines: "warn" }).kind, "needs_approval");
});

test("two invoice lines of one item cannot both claim the pending quantity", () => {
  const split = [
    { index: 0, description: "Crema 1", itemId: "C", quantity: 20, rate: 96, amount: 1920 },
    { index: 1, description: "Crema 2", itemId: "C", quantity: 20, rate: 96, amount: 1920 },
  ];
  const cmp = comparePoLines(split, po, DEFAULT_PO_MATCH_CONFIG, { requireReceipt: false, invoiceTotal: 12500 });
  assert.deepEqual(cmp.lines.map((l) => l.status), ["match", "qty_over"]);
});

test("stored config and vendor rules resolve by specificity", () => {
  assert.equal(parsePoMatchConfig({ total_tolerance_type: "amount", total_tolerance_value: "25" }).totalToleranceValue, 25);
  const fallback: VendorRuleConfig = parseVendorRuleConfig({});
  const rules = [
    { id: "d", scope: "default" as const, targetKey: "*", targetLabel: null, config: { poRequirement: "optional" } },
    { id: "c", scope: "category" as const, targetKey: "7", targetLabel: "Materia prima", config: { poRequirement: "required", requireReceipt: true } },
    { id: "v", scope: "vendor" as const, targetKey: "55", targetLabel: "Cisco Foods", config: { poRequirement: "required", priceTolerancePct: 2 } },
  ];
  assert.equal(resolveVendorRule(rules, { internalId: "55", categoryId: "7" }, fallback).ruleId, "v");
  assert.equal(resolveVendorRule(rules, { internalId: "99", categoryId: "7" }, fallback).requireReceipt, true);
  assert.equal(resolveVendorRule(rules, { internalId: "99", categoryId: null }, fallback).ruleLabel, "Predeterminada");
  assert.equal(resolveVendorRule([], { internalId: null, categoryId: null }, fallback).ruleId, null);
});
