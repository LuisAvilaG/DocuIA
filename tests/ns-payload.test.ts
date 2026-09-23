import test from "node:test";
import assert from "node:assert/strict";
import { buildNsPayload, draftFromReviewBody, draftFromUiPayload, storedDraft, type NsDraft } from "../lib/workflow/ns-payload";

const org = "10000000-0000-4000-8000-000000000001";

const uiPayload = {
  document: {
    vendor: { name: "Proveedor SA", options: [], selected_internal_id: "77" },
    invoice_number: "F-100",
    invoice_date: "2026-09-01",
    due_date: "2026-10-01",
    purchase_order: null,
    currency: "MXN",
    totals: { subtotal: "100", tax: "16", total: "116" },
    lines: [
      { description: "Tornillo", quantity: 2, rate: 50, amount: 100, selected_item_id: "501", selected_unit_id: "1" },
      { description: "Sin mapear", quantity: 1, rate: 0, amount: 0, selected_item_id: null, selected_unit_id: null },
    ],
  },
} as unknown as Parameters<typeof draftFromUiPayload>[0];

test("every posting path sends the NetSuite subsidiary id and a deterministic external id", () => {
  const payload = buildNsPayload(draftFromUiPayload(uiPayload), {
    organizationId: org, documentId: 42, documentType: "invoice", nsSubsidiaryId: "3", dryRun: false,
  });
  assert.equal(payload.subsidiary_internal_id, "3");
  assert.equal(payload.external_id, `docuia:${org}:42`);
  assert.equal(payload.due_date, "2026-10-01");
  assert.deepEqual((payload.line_items as unknown[]).length, 1, "unmapped lines are never posted");
});

test("review body is validated and normalized", () => {
  assert.equal(draftFromReviewBody({ line_items: [] }), "Selecciona un proveedor de NetSuite");
  assert.equal(draftFromReviewBody({ vendor_internal_id: "7", line_items: [{ internal_id: "" }] }), "Se requiere al menos una línea con ítem de NetSuite");
  const draft = draftFromReviewBody({
    vendor_internal_id: "7", invoice_number: "A1", invoice_date: "2026-09-01", due_date: null, currency: "USD",
    location_internal_id: "9", po_internal_id: "",
    line_items: [{ internal_id: "10", item_document_name: "X", quantity: "3", rate: "1.5", amount: 4.5, unit: null }],
  }) as NsDraft;
  assert.equal(draft.poId, null);
  assert.equal(draft.locationId, "9");
  assert.deepEqual(draft.lines[0], { internal_id: "10", item_document_name: "X", quantity: 3, rate: 1.5, amount: 4.5, unit: null });
});

test("pending approval replays the reviewer's draft, falling back to the matched payload", () => {
  const edited: NsDraft = {
    vendorId: "8", vendorName: "Otro", invoiceNumber: "F-100", invoiceDate: "2026-09-01", dueDate: null,
    currency: "MXN", locationId: "4", poId: "900",
    lines: [{ internal_id: "600", item_document_name: "Corregido", quantity: 1, rate: 10, amount: 10, unit: null }],
  };
  assert.deepEqual(storedDraft({ ...uiPayload, approval_draft: edited }), edited);
  assert.equal(storedDraft(uiPayload)?.vendorId, "77");
  assert.equal(storedDraft({ document: { ...uiPayload.document, lines: [] } }), null);
  assert.equal(storedDraft(null), null);
});
