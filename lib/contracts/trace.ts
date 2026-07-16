import { topoOrder, type FlowGraph, type FlowNodeKind } from "./flow";
import { runValidations, type DocsByType } from "./validate";

// A per-stage record of how a case ran through the flow, in execution order.
// Persisted on the case so the UI can show the flow advancing node by node.
export interface FlowStage {
  nodeId: string;
  kind:   FlowNodeKind;
  label:  string;
  status: "done" | "empty";
  detail: string;
}

export interface DocMeta { documentId: string; type: string; typeName: string; fields: number }

export function buildFlowTrace(
  graph: FlowGraph,
  docsByType: DocsByType,
  docs: DocMeta[],
  hasTemplate: boolean,
): FlowStage[] {
  return topoOrder(graph).map((n): FlowStage => {
    if (n.kind === "intake") {
      const matched = docs.filter((d) => d.type === n.data.docTypeKey);
      return {
        nodeId: n.id, kind: n.kind, label: `Entra: ${n.data.name}`,
        status: matched.length ? "done" : "empty",
        detail: matched.length ? `${matched.length} documento(s)` : "sin documento",
      };
    }
    if (n.kind === "extract") {
      const matched = docs.filter((d) => d.type === n.data.docTypeKey);
      const fields = matched.reduce((a, d) => a + d.fields, 0);
      return {
        nodeId: n.id, kind: n.kind, label: `Extrae: ${n.data.docTypeKey}`,
        status: matched.length ? "done" : "empty",
        detail: matched.length ? `${fields} campo(s) extraído(s)` : "sin documento",
      };
    }
    if (n.kind === "validate") {
      const res = runValidations([{ name: n.data.name, severity: n.data.severity, conditionsJson: n.data.rule }], docsByType, new Date());
      const by: Record<string, number> = {};
      for (const r of res) by[r.status] = (by[r.status] ?? 0) + 1;
      return {
        nodeId: n.id, kind: n.kind, label: `Valida: ${n.data.name}`,
        status: res.length ? "done" : "empty",
        detail: res.length ? Object.entries(by).map(([s, c]) => `${c} ${s}`).join(", ") : "sin sujetos",
      };
    }
    return {
      nodeId: n.id, kind: n.kind, label: `Genera: ${n.data.name}`,
      status: hasTemplate ? "done" : "empty",
      detail: hasTemplate ? n.data.templateKey : "sin plantilla",
    };
  });
}
