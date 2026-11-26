import test from "node:test";
import assert from "node:assert/strict";
import { assembleResults, type AnalysisOutcome } from "../lib/contracts/assemble";
import { validateFlowReferences, type FlowGraph } from "../lib/contracts/flow";
import { addToDate, adoptParts, evaluateCalculations, type CalculationDefinition } from "../lib/contracts/calculations";
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

// Cotizador de garantías (Lockton): anticipo, mínimos en SMMLV y vigencias con fecha.
// Datos tomados de los casos reales SN-CTO-26-0117 y CSCG-ABS-021.
const smmlv = { key: "smmlv", label: "SMMLV vigente", value: 1750905 };
const garantias: CalculationDefinition = {
  key: "garantias_porcentuales", label: "Garantías porcentuales", base: { docType: "contrato", field: "valor_contrato" }, operation: "percentage",
  operand: { type: "item", key: "cantidad" }, decimals: 0, mode: "each_analysis_item", analysisNodeId: "ai", itemFilter: { key: "tipo", value: "porcentaje" },
  fixedValues: [smmlv], minimum: { amount: { type: "item", key: "minimo_smmlv" }, unit: { type: "fixed", key: "smmlv" } },
  currency: { rates: [{ code: "USD", fixedKey: "trm_usd" }] },
  term: {
    anchors: { inicio: { docType: "contrato", field: "fecha_inicio" }, terminacion: { docType: "contrato", field: "fecha_terminacion" } },
    startKey: "vigencia_desde_ref", endKey: "vigencia_hasta_ref", monthsKey: "vigencia_meses_adicionales",
  },
};
const anticipo: CalculationDefinition = {
  ...garantias, key: "garantias_anticipo", label: "Garantías sobre el anticipo", base: { docType: "contrato", field: "valor_anticipo" },
  itemFilter: { key: "tipo", value: "porcentaje_anticipo" }, minimum: undefined,
};
const snCto = { contrato: [{ values: {
  valor_contrato: "$76.766.897", valor_anticipo: "$38.081.967", fecha_inicio: "13 de noviembre de 2026", fecha_terminacion: "30 de diciembre de 2026",
} }] };
const snItems: Record<string, Array<{ values: Record<string, string> }>> = { ai: [
  { values: { amparo: "Buen manejo del anticipo", tipo: "porcentaje_anticipo", cantidad: "100", vigencia_desde_ref: "inicio", vigencia_hasta_ref: "terminacion", vigencia_meses_adicionales: "6" } },
  { values: { amparo: "Cumplimiento", tipo: "porcentaje", cantidad: "30", vigencia_desde_ref: "inicio", vigencia_hasta_ref: "terminacion", vigencia_meses_adicionales: "6" } },
  { values: { amparo: "Estabilidad de la obra", tipo: "porcentaje", cantidad: "30", vigencia_desde_ref: "entrega", vigencia_hasta_ref: "entrega", vigencia_meses_adicionales: "36" } },
  { values: { amparo: "RCE", tipo: "porcentaje", cantidad: "100", minimo_smmlv: "200", vigencia_desde_ref: "inicio", vigencia_hasta_ref: "terminacion", vigencia_meses_adicionales: "6" } },
] };

test("the advance guarantee is computed on the advance, not on the contract value", () => {
  const [porcentuales, sobreAnticipo] = evaluateCalculations([garantias, anticipo], snCto, snItems);
  assert.deepEqual(sobreAnticipo.items?.map((item) => [item.values.amparo, item.value]), [["Buen manejo del anticipo", 38081967]]);
  assert.ok(!porcentuales.items?.some((item) => item.values.tipo === "porcentaje_anticipo"));
});

test("a minimum in SMMLV wins when it is greater than the percentage", () => {
  const [result] = evaluateCalculations([garantias], snCto, snItems);
  const rce = result.items?.find((item) => item.values.amparo === "RCE");
  assert.equal(rce?.value, 350181000, "200 × 1.750.905 is more than 100 % of 76.766.897");
  assert.equal(rce?.minimumApplied, true);
  const cumplimiento = result.items?.find((item) => item.values.amparo === "Cumplimiento");
  assert.equal(cumplimiento?.value, 23030069);
  assert.equal(cumplimiento?.minimum, undefined, "no minimum column, no minimum");
  assert.match(result.formula, /mínimo minimo_smmlv × smmlv/);
});

test("a contract in dollars needs the exchange rate only to compare with a minimum in pesos", () => {
  const usd = { contrato: [{ values: { valor_contrato: "USD 165.801,19", fecha_terminacion: "5 de febrero de 2027", fecha_inicio: "con la expedición de la orden de compra" } }] };
  const items: Record<string, Array<{ values: Record<string, string> }>> = { ai: [
    { values: { amparo: "Cumplimiento", tipo: "porcentaje", cantidad: "20", vigencia_desde_ref: "inicio", vigencia_hasta_ref: "terminacion", vigencia_meses_adicionales: "3" } },
    { values: { amparo: "RCE", tipo: "porcentaje", cantidad: "100", minimo_smmlv: "200" } },
  ] };
  const [withoutRate] = evaluateCalculations([garantias], usd, items);
  assert.deepEqual(withoutRate.items?.map((item) => [item.value, item.currency, item.status]), [[33160, "USD", "ok"], [null, "USD", "missing"]]);
  assert.match(withoutRate.items?.[1].reason ?? "", /USD.*tasa de cambio/);

  const [withRate] = evaluateCalculations([{ ...garantias, fixedValues: [smmlv, { key: "trm_usd", label: "TRM", value: 4000 }] }], usd, items);
  const rce = withRate.items?.[1];
  assert.equal(rce?.value, 663204760);
  assert.equal(rce?.currency, undefined, "converted to pesos");
  assert.deepEqual(rce?.conversion, { from: "USD", amount: 165801.19, rate: 4000 });
  assert.equal(withRate.items?.[0].currency, "USD", "without a minimum the guarantee keeps the contract currency");

  // Start depends on the purchase order: no date; end is 5 Feb 2027 + 3 months.
  assert.deepEqual(withRate.items?.[0].term, { start: null, end: "2027-05-05", reason: "Vigencia sin fecha exacta: el contrato no fija la fecha de inicio." });
});

test("term dates come from the contract dates the model points to", () => {
  const [result] = evaluateCalculations([garantias], snCto, snItems);
  assert.deepEqual(result.items?.[0].term, { start: "2026-11-13", end: "2027-06-30" });
  const estabilidad = result.items?.find((item) => item.values.amparo === "Estabilidad de la obra");
  assert.deepEqual(estabilidad?.term, { start: null, end: null, reason: "Vigencia sin fecha exacta: el contrato no fija la fecha de entrega." });
  // Anchors match without accents; the reason shows the word as written.
  const [noSigning] = evaluateCalculations([{ ...garantias, term: { ...garantias.term!, anchors: { ...garantias.term!.anchors, suscripcion: { docType: "contrato", field: "fecha_suscripcion" } } } }], snCto,
    { ai: [{ values: { amparo: "RCE", tipo: "porcentaje", cantidad: "30", vigencia_desde_ref: "suscripción", vigencia_hasta_ref: "terminacion", vigencia_meses_adicionales: "6" } }] });
  assert.deepEqual(noSigning.items?.[0].term, { start: null, end: "2027-06-30", reason: "Vigencia sin fecha exacta: el contrato no fija la fecha de suscripción." });
  assert.equal(addToDate("2027-01-31", 1, 0), "2027-02-28");
  assert.equal(addToDate("2026-12-30", 0, 48), "2027-02-16");
});

test("the output rows carry base, minimum and term dates for the Word template", () => {
  const assembled = assembleResults({ ...plan, rules: [], calculations: [garantias] }, snCto as never, [{
    nodeId: "ai", ruleName: "Garantías", severity: "warn", outputMode: "both",
    response: { outcome: "review", summary: "", items: snItems.ai.map((item) => ({ ...item, evidence: null })), citations: [] },
  }], { validationsEnabled: false });
  const rows = assembled.calculationValues.garantias_porcentuales as Array<Record<string, unknown>>;
  const rce = rows.find((row) => row.amparo === "RCE")!;
  assert.equal(rce.value, 350181000);
  assert.equal(rce.minimo, 350181000);
  assert.equal(rce.base_calculo, 76766897);
  assert.equal(rce.vigencia_desde, "13/11/2026");
  assert.equal(rce.vigencia_hasta, "30/06/2027");
});

test("flow references of minimums, rates and terms are checked", () => {
  assert.match(validateFlowReferences(graph({ minimum: { amount: 200, unit: { type: "fixed", key: "smmlv" } } })) ?? "", /valor fijo "smmlv"/);
  assert.match(validateFlowReferences(graph({ currency: { rates: [{ code: "USD", fixedKey: "trm" }] } })) ?? "", /tasa "trm"/);
  assert.match(validateFlowReferences(graph({ term: { anchors: {}, startKey: "a", endKey: "b" } })) ?? "", /vigencias/);
});
