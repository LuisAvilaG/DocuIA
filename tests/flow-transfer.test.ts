import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeAsset, validateFlowTransfer } from "../lib/contracts/flow-transfer";

const intake = { id: "in", kind: "intake", position: { x: 0, y: 0 }, data: { docTypeKey: "contract", name: "Contrato" } };
const generate = {
  id: "out", kind: "generate", position: { x: 300, y: 0 },
  data: { templateKey: "report", name: "Informe", body: "", source: "word",
    wordTemplate: { storageKey: "portable", originalName: "reporte.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", mappings: [], tableRepeats: [] } },
};

function sample(assets: unknown[] = [{ kind: "word", nodeId: "out", contentBase64: "YWJj" }]) {
  return { format: "docuia-contract-flow", version: 1, name: "Flujo portátil", graph: { nodes: [intake, generate], edges: [] }, assets };
}

test("acepta un flujo exportado con su plantilla Word", () => {
  const result = validateFlowTransfer(sample());
  assert.ok("package" in result);
  assert.equal(result.package.graph.nodes.length, 2);
});

test("rechaza importar un flujo Word sin su archivo", () => {
  const result = validateFlowTransfer(sample([]));
  assert.ok("error" in result);
  assert.match(result.error, /plantilla Word/);
});

test("rechaza muestras visuales de otro tipo documental", () => {
  const result = validateFlowTransfer(sample([
    { kind: "word", nodeId: "out", contentBase64: "YWJj" },
    { kind: "visual_variant", documentType: "invoice", name: "Factura", originalName: "muestra.pdf", mimeType: "application/pdf", signatureText: null, mappings: [], isActive: true, contentBase64: "YWJj" },
  ]));
  assert.ok("error" in result);
  assert.match(result.error, /documento que no existe/);
});

test("rechaza base64 inválido y archivos que exceden el límite", () => {
  assert.equal(decodeAsset("!!!!", 20), null);
  assert.equal(decodeAsset("YWJj", 2), null);
  assert.equal(decodeAsset("YWJj", 3)?.toString(), "abc");
});
