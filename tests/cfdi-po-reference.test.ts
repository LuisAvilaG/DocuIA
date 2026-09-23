import test from "node:test";
import assert from "node:assert/strict";
import { findPoReference } from "../lib/workflow/cfdi-parser";

test("finds the PO cited in CondicionesDePago, descriptions or the addenda", () => {
  assert.equal(findPoReference(`<cfdi:Comprobante CondicionesDePago="OC PO117015 60 dias">`), "PO117015");
  assert.equal(findPoReference(`<cfdi:Concepto Descripcion="AJO EN POLVO Orden de compra: 117015"/>`), "117015");
  assert.equal(findPoReference(`<cfdi:Addenda><Pedido>PO-4521</Pedido></cfdi:Addenda>`), "4521");
});

test("ignores seals and documents without a PO", () => {
  assert.equal(findPoReference(`<cfdi:Comprobante Sello="abc/PO12345/xyz" Folio="881">`), "");
  assert.equal(findPoReference(`<cfdi:Comprobante Folio="881" Serie="A">`), "");
});
