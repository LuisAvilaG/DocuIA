import test from "node:test";
import assert from "node:assert/strict";
import { assembleResults, type AnalysisOutcome } from "../lib/contracts/assemble";
import { validateFlowReferences, type FlowGraph } from "../lib/contracts/flow";
import type { ContractPlan } from "../lib/contracts/plan";

const plan: ContractPlan = {
  source: "flow", flowId: "f1", flow: null, docTypes: [], fieldsByType: {}, template: null,
  rules: [
    { nodeId: "ai1", name: "Revisión IA", severity: "warn", conditionsJson: { kind: "ai_analysis", prompt: "x", outputMode: "free", outputFields: [] } },
  ],
  calculations: [{
    key: "prima", label: "Prima", base: { docType: "poliza", field: "valor" }, operation: "multiply", operand: 0.1, decimals: 0,
  }],
};

const blocked: AnalysisOutcome = {
  nodeId: "ai1", ruleName: "Revisión IA", severity: "warn", outputMode: "free",
  response: { outcome: "block", summary: "Cláusula prohibida", items: [], citations: [] },
};

test("a corrected field keeps AI blocks and recomputes calculations", () => {
  const before = assembleResults(plan, { poliza: [{ values: { valor: "$1.000.000" }, citations: {} }] }, [blocked], { validationsEnabled: true });
  const after = assembleResults(plan, { poliza: [{ values: { valor: "$2.000.000" }, citations: {} }] }, [blocked], { validationsEnabled: true });
  assert.equal(before.calculationValues.prima, 100000);
  assert.equal(after.calculationValues.prima, 200000);
  assert.equal(after.verdict, "block", "an AI block survives the correction");
  assert.equal(after.validations.find((v) => v.subject === "Análisis con IA")?.severity, "block");
});

test("the first document with a value feeds calculations", () => {
  const result = assembleResults(plan, {
    poliza: [{ values: { valor: "" }, citations: {} }, { values: { valor: "500.000" }, citations: {} }],
  }, [], { validationsEnabled: false });
  assert.equal(result.calculationValues.prima, 50000);
});

function graph(calculate: Record<string, unknown>): FlowGraph {
  return {
    nodes: [
      { id: "i", kind: "intake", position: { x: 0, y: 0 }, data: { docTypeKey: "poliza", name: "Póliza" } },
      { id: "e", kind: "extract", position: { x: 0, y: 0 }, data: { docTypeKey: "poliza", fields: [{ fieldKey: "valor", label: "Valor" }] } },
      { id: "c", kind: "calculate", position: { x: 0, y: 0 }, data: {
        name: "Prima", key: "prima", label: "Prima", base: { docType: "poliza", field: "valor" }, operation: "multiply",
        operand: 0.1, decimals: 0, fixedValues: [], mode: "single", ...calculate,
      } },
    ],
    edges: [],
  } as unknown as FlowGraph;
}

test("flow references are checked for operands, fixed values and AI nodes", () => {
  assert.equal(validateFlowReferences(graph({})), null);
  assert.match(validateFlowReferences(graph({ operand: { type: "fixed", key: "tasa" } })) ?? "", /valor fijo "tasa"/);
  assert.match(validateFlowReferences(graph({ operand: { type: "item", key: "pct" } })) ?? "", /no recorre un análisis/);
  assert.match(validateFlowReferences(graph({ mode: "each_analysis_item", analysisNodeId: "missing" })) ?? "", /ya no existe/);
  assert.match(validateFlowReferences(graph({ operand: { docType: "poliza", field: "otro" } })) ?? "", /no lo produce/);
});
