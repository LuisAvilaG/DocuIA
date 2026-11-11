import test from "node:test";
import assert from "node:assert/strict";
import { reviewCorrections } from "../lib/workflow/review-corrections";
import { poAcceptance } from "../lib/workflow/doc-metrics";
import { erpRejectionBucket, fallbackBucket } from "../lib/stats/ap-metrics";
import type { NsDraft } from "../lib/workflow/ns-payload";

const payload = {
  document: {
    vendor: { selected_internal_id: "V1" }, invoice_number: "A-10", invoice_date: "2026-11-01", due_date: null, currency: "MXN",
    lines: [
      { selected_item_id: "I1", quantity: 2, rate: 10, amount: 20 },
      { selected_item_id: null, quantity: 1, rate: 5, amount: 5 },
    ],
  },
};
const draft = (over: Partial<NsDraft> = {}): NsDraft => ({
  vendorId: "V1", vendorName: null, invoiceNumber: "A-10", invoiceDate: "2026-11-01", dueDate: null, currency: "MXN", locationId: null, poId: null,
  lines: [
    { internal_id: "I1", item_document_name: "", quantity: 2, rate: 10, amount: 20, unit: null },
    { internal_id: "I9", item_document_name: "", quantity: 1, rate: 5, amount: 5, unit: null },
  ],
  ...over,
});

test("sin cambios no hay correcciones; asignar un ítem que la IA no eligió no cuenta", () => {
  assert.deepEqual(reviewCorrections(payload, draft()), {});
});

test("cuenta campos de cabecera y de cada línea", () => {
  const d = draft({ invoiceNumber: "A-11", vendorId: "V2" });
  d.lines[0] = { ...d.lines[0], internal_id: "I2", rate: 11 };
  assert.deepEqual(reviewCorrections(payload, d), { vendor: 1, invoice_number: 1, item: 1, rate: 1 });
  assert.deepEqual(reviewCorrections(payload, draft({ lines: draft().lines.slice(0, 1) })), { line_count: 1 });
  assert.deepEqual(reviewCorrections(null, draft()), {});
});

test("cómo se aceptó la diferencia con la OC", () => {
  assert.equal(poAcceptance({ totalDifference: 0, counts: {} }, "ok"), "match");
  assert.equal(poAcceptance({ totalDifference: 12.5, counts: {} }, "ok"), "tolerance");
  assert.equal(poAcceptance({ totalDifference: 0, counts: { price_within_tolerance: 2 } }, "ok"), "tolerance");
  assert.equal(poAcceptance({ totalDifference: 90, counts: {} }, "needs_approval"), "approval");
});

test("motivos del segundo modelo y rechazos del ERP agrupados", () => {
  assert.equal(fallbackBucket("las líneas no cuadran con el total (diferencia 3.00)"), "Las líneas no cuadran con el total");
  assert.equal(fallbackBucket("el modelo duda de total, vendor"), "El modelo dudó");
  assert.equal(erpRejectionBucket("The accounting period is closed", null), "Periodo contable cerrado");
  assert.equal(erpRejectionBucket("Item 12 is inactive", null), "Registro inactivo en el ERP");
  assert.equal(erpRejectionBucket("RESTlet timeout", null), "El ERP no respondió");
  assert.equal(erpRejectionBucket("algo raro", null), "Otro error");
});

test("nombre legible de un campo de contrato", async () => {
  const { fieldLabel } = await import("../lib/stats/contract-metrics");
  assert.equal(fieldLabel("valor_total"), "Valor total");
  assert.equal(fieldLabel("poliza.numero"), "Poliza numero");
});
