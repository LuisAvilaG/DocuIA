import { flowGraphSchema } from "@/lib/contracts/flow";

/** «documento.dato» → el nombre del dato en los flujos («Monto (UF)»). */
export function fieldLabelsFromFlows(graphs: unknown[]): Map<string, string> {
  const labels = new Map<string, string>();
  for (const json of graphs) {
    const graph = flowGraphSchema.safeParse(json);
    if (!graph.success) continue;
    for (const node of graph.data.nodes) {
      if (node.kind !== "extract") continue;
      for (const field of node.data.fields) {
        const key = `${node.data.docTypeKey}.${field.fieldKey}`;
        if (!labels.has(key)) labels.set(key, field.label);
      }
    }
  }
  return labels;
}
