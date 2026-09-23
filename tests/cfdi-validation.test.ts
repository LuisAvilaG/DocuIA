import test from "node:test";
import assert from "node:assert/strict";
import { parseSatResponse, satExpression } from "../lib/cfdi/sat";
import { evaluateFiscalValidation, parseSatValidationConfig, type FiscalInputs } from "../lib/cfdi/validation";

const VIGENTE = `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><ConsultaResponse xmlns="http://tempuri.org/"><ConsultaResult xmlns:a="http://schemas.datacontract.org/2004/07/Sat"><a:CodigoEstatus>S - Comprobante obtenido satisfactoriamente.</a:CodigoEstatus><a:EsCancelable>Cancelable sin aceptación</a:EsCancelable><a:Estado>Vigente</a:Estado><a:EstatusCancelacion/><a:ValidacionEFOS>200</a:ValidacionEFOS></ConsultaResult></ConsultaResponse></s:Body></s:Envelope>`;
const NOT_FOUND = `<s:Envelope><s:Body><ConsultaResponse><ConsultaResult xmlns:a="x"><a:CodigoEstatus>N - 602: Comprobante no encontrado.</a:CodigoEstatus><a:EsCancelable/><a:Estado>No Encontrado</a:Estado><a:EstatusCancelacion/><a:ValidacionEFOS/></ConsultaResult></ConsultaResponse></s:Body></s:Envelope>`;

test("SAT responses and expression", () => {
  assert.equal(parseSatResponse(VIGENTE)?.estado, "Vigente");
  assert.equal(parseSatResponse(NOT_FOUND)?.estado, "No Encontrado");
  assert.equal(parseSatResponse("<html>error</html>"), null);
  assert.equal(satExpression({ emisorRfc: "cfo980112qx7", receptorRfc: "ANO010203AB4", total: 12480, uuid: "6f9a-uuid" }),
    "?re=CFO980112QX7&rr=ANO010203AB4&tt=12480.00&id=6F9A-UUID");
});

const base: FiscalInputs = {
  uuid: "6F9A2C1E-4D7B-4A0E-9C3F-21E0B5D98B41",
  emisorRfc: "CFO980112QX7",
  receptorRfc: "ANO010203AB4",
  sat: parseSatResponse(VIGENTE),
  subsidiaryTaxId: "ANO-010203-AB4",
  subsidiaryName: "Alimentos del Norte",
  duplicateOf: null,
  vendor: { name: "Cisco Foods", rfc: "CFO980112QX7" },
};
const cfg = parseSatValidationConfig({});

test("a valid CFDI passes every check", () => {
  const r = evaluateFiscalValidation(base, cfg);
  assert.equal(r.outcome, "ok");
  assert.deepEqual(r.checks.map((c) => c.ok), [true, true, true, true]);
});

test("cancelled, wrong receiver or duplicate UUID block the document", () => {
  assert.equal(evaluateFiscalValidation({ ...base, sat: parseSatResponse(NOT_FOUND) }, cfg).outcome, "blocked");
  assert.equal(evaluateFiscalValidation({ ...base, sat: parseSatResponse(NOT_FOUND) }, parseSatValidationConfig({ on_cancelled: "review" })).outcome, "review");
  assert.equal(evaluateFiscalValidation({ ...base, receptorRfc: "XAXX010101000" }, cfg).outcome, "blocked");
  const dup = evaluateFiscalValidation({ ...base, duplicateOf: { id: 88, numDoc: "F-1" } }, cfg);
  assert.equal(dup.outcome, "blocked");
  assert.match(dup.reason ?? "", /UUID/);
});

test("an unreachable SAT leaves the document in review unless configured to continue", () => {
  const down = { ...base, sat: new Error("timeout") };
  assert.equal(evaluateFiscalValidation(down, cfg).outcome, "review");
  assert.equal(evaluateFiscalValidation(down, parseSatValidationConfig({ on_sat_unavailable: "continue" })).outcome, "ok");
});

test("missing subsidiary or vendor RFC is reported, not failed", () => {
  const r = evaluateFiscalValidation({ ...base, subsidiaryTaxId: null, vendor: { name: "X", rfc: null } }, cfg);
  assert.equal(r.outcome, "ok");
  assert.equal(r.checks.find((c) => c.key === "receiver_rfc")?.ok, null);
  assert.equal(r.checks.find((c) => c.key === "issuer_rfc")?.ok, null);
});
