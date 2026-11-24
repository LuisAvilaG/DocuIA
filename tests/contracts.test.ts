import test from "node:test";
import assert from "node:assert/strict";
import { assembleResults, type AnalysisOutcome } from "../lib/contracts/assemble";
import { validateFlowReferences, type FlowGraph } from "../lib/contracts/flow";
import { adoptParts, evaluateCalculations, type CalculationDefinition } from "../lib/contracts/calculations";
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

// The case shows "base × factor = result": every result keeps its two sides.
const perItem: CalculationDefinition = {
  key: "garantias", label: "Sobre el valor del contrato", base: { docType: "contrato", field: "valor" }, operation: "percentage",
  operand: { type: "item", key: "porcentaje" }, decimals: 0, mode: "each_analysis_item", analysisNodeId: "ai1",
};
const contrato = { contrato: [{ values: { valor: "58.833.600" } }] };
const amparos = { ai1: [{ values: { amparo: "Cumplimiento", porcentaje: "20" }, evidence: "a) Cumplimiento" }, { values: { amparo: "Salarios", porcentaje: "5" }, evidence: null }] };

test("a calculation keeps the operation and the two sides of each result", () => {
  const [result] = evaluateCalculations([perItem], contrato, amparos);
  assert.equal(result.operation, "percentage");
  assert.deepEqual(result.parts?.base, { source: "field", name: "valor", docType: "contrato", value: 58833600 });
  assert.equal(result.parts?.operand.source, "item");
  assert.equal(result.parts?.operand.value, null, "a side read from each item has no single value");
  assert.deepEqual(result.items?.map((item) => [item.base, item.operand, item.value]), [[58833600, 20, 11766720], [58833600, 5, 2941680]]);

  const [fixed] = evaluateCalculations([{
    key: "rc", label: "RC", base: { type: "fixed", key: "smmlv" }, operation: "multiply", operand: 15, decimals: 0,
    fixedValues: [{ key: "smmlv", label: "Salario mínimo", value: 1423500 }],
  }], {});
  assert.deepEqual(fixed.parts?.base, { source: "fixed", name: "smmlv", label: "Salario mínimo", value: 1423500 });
  assert.equal(fixed.value, 21352500);

  const [missing] = evaluateCalculations([perItem], {}, amparos);
  assert.deepEqual(missing.items?.map((item) => [item.base, item.operand, item.value]), [[null, 20, null], [null, 5, null]]);
});

test("a stored result adopts the operation only where the number is the same", () => {
  const [fresh] = evaluateCalculations([perItem], contrato, amparos);
  const old = { key: "garantias", label: "Sobre el valor del contrato", value: null, status: "ok" as const, formula: "base × porcentaje%", sourceValue: null,
    items: [{ values: amparos.ai1[0].values, value: 11766720, status: "ok" as const }, { values: amparos.ai1[1].values, value: 2941680, status: "ok" as const }] };
  const adopted = adoptParts(old, fresh);
  assert.equal(adopted.operation, "percentage");
  assert.deepEqual(adopted.items?.map((item) => [item.base, item.operand]), [[58833600, 20], [58833600, 5]]);

  // A field corrected since: the stored number stays without an operation that gives another one.
  const changed = { ...old, items: [{ ...old.items[0], value: 1 }, old.items[1]] };
  assert.equal(adoptParts(changed, fresh), changed);
  assert.equal(adoptParts(old, undefined), old);
});
