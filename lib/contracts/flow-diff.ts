// Qué cambia entre dos versiones de un flujo, en frases para la nota de publicación.
import type { FlowGraph } from "./flow";

const KIND_LABEL: Record<string, string> = {
  intake: "Documento esperado", extract: "Extracción", calculate: "Cálculo", validate: "Control",
  reference_lookup: "Búsqueda en el Archivo", generate: "Documento a generar", approval: "Aprobación", note: "Nota",
};

type Node = FlowGraph["nodes"][number];

function nodeName(n: Node): string {
  const d = n.data as Record<string, unknown>;
  const name = String(d.name ?? d.label ?? d.docTypeKey ?? "").trim();
  return name ? `${KIND_LABEL[n.kind] ?? n.kind} «${name}»` : KIND_LABEL[n.kind] ?? n.kind;
}

/** Lista de cambios: etapas agregadas, quitadas o modificadas y conexiones. Las posiciones no cuentan. */
export function diffFlows(before: FlowGraph | null, after: FlowGraph): string[] {
  const prev = new Map((before?.nodes ?? []).map((n) => [n.id, n]));
  const next = new Map(after.nodes.map((n) => [n.id, n]));
  const changes: string[] = [];
  for (const [id, n] of next) {
    const old = prev.get(id);
    if (!old) changes.push(`Se agregó ${nodeName(n)}`);
    else if (JSON.stringify(old.data) !== JSON.stringify(n.data) || old.kind !== n.kind) changes.push(`Cambió ${nodeName(n)}`);
  }
  for (const [id, n] of prev) if (!next.has(id)) changes.push(`Se quitó ${nodeName(n)}`);
  const edges = (g: FlowGraph | null) => new Set((g?.edges ?? []).map((e) => `${e.source}>${e.target}`));
  const a = edges(before), b = edges(after);
  if (a.size !== b.size || [...b].some((e) => !a.has(e))) changes.push("Cambiaron las conexiones entre etapas");
  return changes;
}
