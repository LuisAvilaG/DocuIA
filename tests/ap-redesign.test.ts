import test from "node:test";
import assert from "node:assert/strict";
import { friendlyError } from "../lib/ap/friendly-error";
import { invoiceStages, parseInvoiceTab, type StageInput } from "../lib/ap/invoice-stages";

test("errores técnicos se vuelven una frase legible", () => {
  assert.equal(
    friendlyError('400 {"type":"error","error":{"type":"invalid_request_error","message":"messages.0.content.0.pdf.source.base64.data: The PDF specified was not valid."}}'),
    "No se pudo leer el archivo. Revisa que no esté dañado o protegido.",
  );
  assert.equal(friendlyError("Missing GOOGLE_API_KEY environment variable"), "Falta configurar el acceso al servicio de lectura. Avísale a DocuIA.");
  assert.equal(friendlyError('{"code":"X"}'), "Ocurrió un error técnico al procesarlo. Reintenta o avísale a DocuIA.");
  assert.equal(friendlyError("2 líneas sin ítem del ERP"), "2 líneas sin ítem del ERP");
  assert.equal(friendlyError(null), null);
});

const base: StageInput = {
  lines: { total: 4, missing: 0 },
  po: { enabled: true },
  fiscal: null,
  isCfdi: true,
  erp: { state: "off", detail: "Al aprobar" },
};
const byKey = (i: StageInput) => Object.fromEntries(invoiceStages(i).map((s) => [s.key, s]));

test("etapas: líneas sin ítem o sin proveedor quedan en aviso", () => {
  assert.equal(byKey(base).lines.state, "ok");
  assert.equal(byKey({ ...base, lines: { total: 4, missing: 2 } }).lines.detail, "2 líneas sin ítem");
  assert.equal(byKey({ ...base, vendorMissing: true }).lines.detail, "Falta el proveedor");
  assert.equal(byKey({ ...base, lines: { total: 0, missing: 0 } }).lines.state, "off");
});

test("etapas: orden de compra según lo elegido y el resultado", () => {
  assert.equal(byKey({ ...base, po: { enabled: false } }).po.navigable, false);
  assert.equal(byKey({ ...base, po: { enabled: true, required: true } }).po.state, "err");
  assert.equal(byKey({ ...base, po: { enabled: true, suggestions: 1 } }).po.state, "warn");
  assert.equal(byKey({ ...base, po: { enabled: true, selected: "12", outcome: { kind: "ok" } } }).po.detail, "Cuadra con 12");
  assert.equal(byKey({ ...base, po: { enabled: true, selected: "12", outcome: { kind: "await_receipt", reason: "faltan 40" } } }).po.detail, "Falta la recepción");
  assert.equal(byKey({ ...base, po: { enabled: true, selected: "12", outcome: { kind: "blocked", reason: "precio" } } }).po.state, "err");
});

test("etapas: la validación fiscal no aplica a facturas en PDF", () => {
  const pdf = byKey({ ...base, isCfdi: false });
  assert.equal(pdf.fiscal.state, "off");
  assert.equal(pdf.fiscal.navigable, false);
  const ok = byKey({ ...base, fiscal: { checkedAt: "2026-11-11", checks: [], outcome: "ok", reason: null } });
  assert.equal(ok.fiscal.detail, "CFDI válido");
});

test("pestaña de factura desconocida vuelve a Datos y líneas", () => {
  assert.equal(parseInvoiceTab("po"), "po");
  assert.equal(parseInvoiceTab("otra"), "lines");
  assert.equal(parseInvoiceTab(undefined), "lines");
});
