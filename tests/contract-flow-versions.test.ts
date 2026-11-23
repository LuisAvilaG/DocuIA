import test from "node:test";
import assert from "node:assert/strict";
import { diffFlows } from "../lib/contracts/flow-diff";
import type { FlowGraph } from "../lib/contracts/flow";

const graph = (nodes: Array<{ id: string; kind: string; data: Record<string, unknown>; x?: number }>, edges: Array<[string, string]> = []) => ({
  nodes: nodes.map((n) => ({ id: n.id, kind: n.kind, position: { x: n.x ?? 0, y: 0 }, data: n.data })),
  edges: edges.map(([source, target]) => ({ id: `${source}-${target}`, source, target })),
}) as unknown as FlowGraph;

test("cambios entre versiones: agregar, cambiar, quitar y conexiones", () => {
  const before = graph([
    { id: "a", kind: "intake", data: { name: "Contrato", docTypeKey: "contrato" } },
    { id: "b", kind: "validate", data: { name: "Vigencia", severity: "warn" } },
  ], [["a", "b"]]);
  const after = graph([
    { id: "a", kind: "intake", data: { name: "Contrato", docTypeKey: "contrato" }, x: 300 },
    { id: "b", kind: "validate", data: { name: "Vigencia", severity: "block" } },
    { id: "c", kind: "approval", data: { name: "Gerencia" } },
  ], [["a", "c"]]);
  assert.deepEqual(diffFlows(before, after), [
    "Cambió Control «Vigencia»",
    "Se agregó Aprobación «Gerencia»",
    "Cambiaron las conexiones entre etapas",
  ]);
});

test("mover etapas no cuenta como cambio", () => {
  const a = graph([{ id: "a", kind: "intake", data: { name: "Contrato" } }]);
  const b = graph([{ id: "a", kind: "intake", data: { name: "Contrato" }, x: 500 }]);
  assert.deepEqual(diffFlows(a, b), []);
});

test("quitar una etapa y flujo sin versión previa", () => {
  const a = graph([{ id: "a", kind: "intake", data: { name: "Contrato" } }, { id: "n", kind: "note", data: {} }]);
  assert.deepEqual(diffFlows(a, graph([{ id: "a", kind: "intake", data: { name: "Contrato" } }])), ["Se quitó Nota"]);
  assert.deepEqual(diffFlows(null, a), ["Se agregó Documento esperado «Contrato»", "Se agregó Nota"]);
});

test("probar borrador: controles que empiezan o dejan de fallar", async () => {
  const { compareValidations } = await import("../lib/contracts/flow-test");
  const v = (ruleName: string, ok: boolean | null, severity: "warn" | "block" | "info" = "warn") => ({ ruleName, severity, subject: "", ok, status: "", reason: "", checks: [], citation: null });
  const res = compareValidations(
    [v("Vigencia", false), v("Monto", true), v("Nota", false, "info")],
    [v("Vigencia", true), v("Monto", false, "block"), v("Póliza", null)],
  );
  assert.deepEqual(res, { newIssues: ["Monto", "Póliza"], resolved: ["Vigencia"] });
});
