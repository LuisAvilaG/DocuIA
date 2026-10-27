import assert from "node:assert/strict";
import { test } from "node:test";
import { flowGraphSchema, hasCycle, validateFlowReferences } from "../lib/contracts/flow";
import { referenceDemoGraph } from "../lib/contracts/reference-demo";
import { CONTRACT_MAX_PDF_BYTES, validateContractUpload } from "../lib/contracts/uploads";

test("reference demo graph is valid and ordered without cycles", () => {
  const graph = referenceDemoGraph();
  assert.equal(flowGraphSchema.safeParse(graph).success, true);
  assert.equal(hasCycle(graph), false);
  assert.equal(validateFlowReferences(graph), null);
  assert.equal(graph.nodes.filter((node) => node.kind === "reference_lookup").length, 1);
});

test("150 MB PDF is accepted while oversized and unsupported files are rejected", () => {
  assert.equal(validateContractUpload("contrato.pdf", "application/pdf", CONTRACT_MAX_PDF_BYTES), null);
  assert.match(validateContractUpload("contrato.pdf", "application/pdf", CONTRACT_MAX_PDF_BYTES + 1) ?? "", /grande/);
  assert.match(validateContractUpload("audio.mp3", "audio/mpeg", 100) ?? "", /Tipo/);
  assert.match(validateContractUpload("../otro.pdf", "application/pdf", 100) ?? "", /Nombre/);
});
