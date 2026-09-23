import test from "node:test";
import assert from "node:assert/strict";
import { parseCfdi } from "../lib/workflow/cfdi-parser";
import { validateExtraction } from "../lib/workflow/validation";
import type { ExtractedInvoice } from "../lib/workflow/types";

// Honorarios: 10,000 + IVA 1,600 − ISR 1,000 − IVA retenido 1,066.67 = 9,533.33
const HONORARIOS = `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante Version="4.0" Folio="77" Fecha="2026-09-01T10:00:00" SubTotal="10000.00" Moneda="MXN" Total="9533.33" TipoDeComprobante="I">
  <cfdi:Emisor Rfc="AAA010101AAA" Nombre="Despacho SC"/>
  <cfdi:Receptor Rfc="BBB010101BBB" Nombre="Cliente SA" UsoCFDI="G03"/>
  <cfdi:Conceptos>
    <cfdi:Concepto ClaveProdServ="80101500" Cantidad="1" ClaveUnidad="E48" Descripcion="Asesoría fiscal" ValorUnitario="10000.00" Importe="10000.00"/>
  </cfdi:Conceptos>
  <cfdi:Impuestos TotalImpuestosRetenidos="2066.67" TotalImpuestosTrasladados="1600.00"/>
</cfdi:Comprobante>`;

// Discount on a concept: lines must be posted net of it.
const DESCUENTO = `<cfdi:Comprobante Version="4.0" Folio="8" SubTotal="1000.00" Descuento="100.00" Moneda="MXN" Total="1044.00">
  <cfdi:Conceptos>
    <cfdi:Concepto Cantidad="4" Descripcion="Caja" ValorUnitario="250.00" Importe="1000.00" Descuento="100.00"/>
  </cfdi:Conceptos>
  <cfdi:Impuestos TotalImpuestosTrasladados="144.00"/>
</cfdi:Comprobante>`;

function invoiceFrom(xml: string): ExtractedInvoice {
  const c = parseCfdi(xml);
  return {
    format: "general", vendor: c.emisorNombre, invoiceNumber: c.folio, invoiceDate: "", dueDate: "", purchaseOrder: "",
    currency: c.moneda, subtotal: c.subTotal, tax: c.totalTraslados, retention: c.totalRetenciones, total: c.total,
    lines: c.lineas.map((l) => ({ description: l.descripcion, quantity: l.cantidad, rate: null, amount: l.importe - l.descuento, uom: null, itemCode: null })),
  };
}

test("CFDI with withholdings validates against subtotal + traslados − retenciones", () => {
  const cfdi = parseCfdi(HONORARIOS);
  assert.equal(cfdi.totalRetenciones, 2066.67);
  assert.equal(validateExtraction(invoiceFrom(HONORARIOS), {}).level, "ok");
});

test("CFDI concept discounts are parsed and netted from line amounts", () => {
  const cfdi = parseCfdi(DESCUENTO);
  assert.equal(cfdi.lineas[0].descuento, 100);
  assert.equal(validateExtraction(invoiceFrom(DESCUENTO), {}).level, "ok");
});

test("a real mismatch is still reported", () => {
  const invoice = { ...invoiceFrom(HONORARIOS), total: 12000 };
  assert.equal(validateExtraction(invoice, {}).level, "error");
});
