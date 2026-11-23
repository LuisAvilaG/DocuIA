import test from "node:test";
import assert from "node:assert/strict";
import { normalizeQaConfig, qaModeActive, qaDocumentNumber, isoDay } from "../lib/features/qa-mode";
import { TENANT_EDITABLE } from "../lib/features/tenant-editable";
import { FEATURE_CATALOG } from "../lib/features/catalog";
import { FEATURE_PRODUCT } from "../lib/products/registry";
import { suggestInvoiceFormat, isInvoiceFormat } from "../lib/subsidiaries/invoice-format";

const NOW = new Date("2026-11-11T15:00:00Z");

test("modo QA: solo se enciende con el ERP en sandbox", () => {
  const r = normalizeQaConfig({}, "production", NOW);
  assert.equal(r.ok, false);
  assert.equal(normalizeQaConfig({}, null, NOW).ok, false);
});

test("modo QA: sin fecha dura 7 días y completa los valores por defecto", () => {
  const r = normalizeQaConfig({ expires_on: "" }, "sandbox", NOW);
  assert.ok(r.ok);
  assert.deepEqual(r.config, { applies_to: "invoices", number_suffix: "-QA{n}", skip_duplicates: true, expires_on: "2026-11-18" });
});

test("modo QA: rechaza fechas pasadas, inválidas o de más de 30 días", () => {
  assert.equal(normalizeQaConfig({ expires_on: "2026-11-10" }, "sandbox", NOW).ok, false);
  assert.equal(normalizeQaConfig({ expires_on: "2026-02-30" }, "sandbox", NOW).ok, false);
  assert.equal(normalizeQaConfig({ expires_on: "11/20/2026" }, "sandbox", NOW).ok, false);
  assert.equal(normalizeQaConfig({ expires_on: isoDay(NOW, 31) }, "sandbox", NOW).ok, false);
  assert.ok(normalizeQaConfig({ expires_on: isoDay(NOW, 30) }, "sandbox", NOW).ok);
  assert.ok(normalizeQaConfig({ expires_on: "2026-11-11" }, "sandbox", NOW).ok);
});

test("modo QA: el sufijo lleva {n} y caracteres seguros", () => {
  assert.equal(normalizeQaConfig({ number_suffix: "-QA" }, "sandbox", NOW).ok, false);
  assert.equal(normalizeQaConfig({ number_suffix: "-Q A{n}" }, "sandbox", NOW).ok, false);
  assert.equal(normalizeQaConfig({ number_suffix: "{n}{n}" }, "sandbox", NOW).ok, false);
  assert.equal(normalizeQaConfig({ applies_to: "everything" }, "sandbox", NOW).ok, false);
  const r = normalizeQaConfig({ number_suffix: "_T{n}" }, "sandbox", NOW);
  assert.ok(r.ok && r.config.number_suffix === "_T{n}");
});

test("modo QA vigente: concedido, en sandbox y sin vencer (el día de vencimiento cuenta)", () => {
  const cfg = { expires_on: "2026-11-11" };
  assert.equal(qaModeActive(true, cfg, "sandbox", NOW), true);
  assert.equal(qaModeActive(true, cfg, "production", NOW), false);
  assert.equal(qaModeActive(false, cfg, "sandbox", NOW), false);
  assert.equal(qaModeActive(true, { expires_on: "2026-11-10" }, "sandbox", NOW), false);
  assert.equal(qaModeActive(true, {}, "sandbox", NOW), false);
});

test("modo QA: número del documento con sufijo", () => {
  assert.equal(qaDocumentNumber("F-1001", "-QA{n}", 2), "F-1001-QA2");
});

test("campos editables por el cliente existen en el catálogo", () => {
  const byId = new Map(FEATURE_CATALOG.map((f) => [f.id as string, f]));
  for (const [id, rule] of Object.entries(TENANT_EDITABLE)) {
    const f = byId.get(id);
    assert.ok(f, `feature ${id} no está en el catálogo`);
    const keys = new Set(((f.configSchema ?? []) as ReadonlyArray<{ key: string }>).map((p) => p.key));
    for (const k of rule.keys ?? []) assert.ok(keys.has(k), `${id}.${k} no está en el configSchema`);
  }
});

test("features nuevas del rediseño: en el catálogo, con producto y apagadas salvo carga manual", () => {
  const byId = new Map(FEATURE_CATALOG.map((f) => [f.id as string, f]));
  for (const id of ["qa_mode", "manual_upload", "contract_flow_versions", "contract_approval_rules", "contract_document_requests"]) {
    const f = byId.get(id);
    assert.ok(f, id);
    assert.ok(FEATURE_PRODUCT[id], `${id} sin producto`);
    assert.equal(f.defaultEnabled, id === "manual_upload", `${id} defaultEnabled`);
  }
  const ids = FEATURE_CATALOG.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length, "ids duplicados en el catálogo");
});

test("formato de factura sugerido por subsidiaria", () => {
  assert.equal(suggestInvoiceFormat("es-MX", "USD"), "cfdi");
  assert.equal(suggestInvoiceFormat("en-US", "mxn"), "cfdi");
  assert.equal(suggestInvoiceFormat("en-US", "USD"), "pdf");
  assert.equal(isInvoiceFormat("xml"), false);
});

test("ajustes del cliente: solo campos suyos y con su tipo y rango", async () => {
  const { validateTenantConfig } = await import("../lib/features/tenant-editable");
  const schema = (FEATURE_CATALOG.find((f) => f.id === "po_matching")!.configSchema ?? []) as unknown as Parameters<typeof validateTenantConfig>[1];
  assert.deepEqual(validateTenantConfig("po_matching", schema, { on_mismatch: "warn", suggest_by_total: false }), { ok: true, config: { on_mismatch: "warn", suggest_by_total: false } });
  assert.equal(validateTenantConfig("po_matching", schema, { on_mismatch: "borrar" }).ok, false);
  assert.equal(validateTenantConfig("po_matching", schema, { suggest_by_total: "sí" }).ok, false);
  assert.equal(validateTenantConfig("po_matching", schema, { otra_cosa: 1 }).ok, false);
  const mapSchema = (FEATURE_CATALOG.find((f) => f.id === "auto_mapping")!.configSchema ?? []) as unknown as Parameters<typeof validateTenantConfig>[1];
  assert.equal(validateTenantConfig("auto_mapping", mapSchema, { merge_similarity: 0.9 }).ok, false, "campo técnico");
  assert.equal(validateTenantConfig("ai_model_selection", [], { primary_model: "x" }).ok, false, "feature sin campos del cliente");
});
