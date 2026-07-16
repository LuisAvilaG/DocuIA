import { z } from "zod";
import type { ContractPreset } from "./presets";
import { ruleRefs, type ValidationRule, type Severity } from "./validate";
import type { ContractDoc } from "./generate";

// ── Flow graph model ──────────────────────────────────────────────────
// The visual canvas builder produces this graph. compileFlow() turns it into
// the engine's runtime config (doc types, field schemas, validation rules and
// the output template), so the existing pipeline can consume a flow unchanged.
//
// Node kinds map 1:1 to the user's mental model:
//   intake   → "entra este documento"   (which doc type is expected)
//   extract  → "extrae estos campos"    (fields to pull from that doc)
//   validate → "valida esto"            (cross-document rule)
//   generate → "al final genera esto"   (output template)

export type FlowNodeKind = "intake" | "extract" | "validate" | "generate";

const zPosition = z.object({ x: z.number(), y: z.number() });
const zField = z.object({
  fieldKey: z.string().min(1),
  label: z.string().min(1),
  isList: z.boolean().default(false),
});

// Validation rule shapes — one discriminated union per rule kind. Mirrors the
// ValidationRule type in validate.ts so compiled conditionsJson runs as-is.
const zRef = z.object({ docType: z.string().min(1), field: z.string().min(1) });
const zRefLabeled = z.object({ docType: z.string().min(1), field: z.string().min(1), label: z.string().min(1) });

const zRule = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("cross_reference"),
    subjects: zRef,
    membership: zRefLabeled,
    confirmation: zRefLabeled.extend({ revokedWhenTruthy: z.boolean().optional() }).optional(),
    statusLabels: z.object({ pass: z.string(), fail: z.string(), unknown: z.string() }).optional(),
  }),
  z.object({ kind: z.literal("field_match"), left: zRef, right: zRef, mode: z.enum(["equal", "different"]).optional(), numericTolerance: z.number().optional() }),
  z.object({ kind: z.literal("clause_presence"), docType: z.string().min(1), field: z.string().min(1), mustExist: z.boolean().optional() }),
  z.object({ kind: z.literal("numeric_threshold"), docType: z.string().min(1), field: z.string().min(1), min: z.number().optional(), max: z.number().optional() }),
  z.object({ kind: z.literal("date_rule"), docType: z.string().min(1), field: z.string().min(1), notExpired: z.boolean().optional(), before: zRef.optional() }),
  z.object({ kind: z.literal("field_format"), docType: z.string().min(1), field: z.string().min(1), format: z.enum(["tax_id", "email", "date", "number", "nonempty"]), country: z.string().optional() }),
  z.object({ kind: z.literal("document_required"), docTypes: z.array(z.string().min(1)).min(1) }),
  z.object({ kind: z.literal("signatures_complete"), subjects: zRef, signatures: zRef }),
]);

const zIntake = z.object({
  id: z.string().min(1), kind: z.literal("intake"), position: zPosition,
  data: z.object({ docTypeKey: z.string().min(1), name: z.string().min(1), hint: z.string().nullish() }),
});
const zExtract = z.object({
  id: z.string().min(1), kind: z.literal("extract"), position: zPosition,
  data: z.object({ docTypeKey: z.string().min(1), fields: z.array(zField).default([]) }),
});
const zValidate = z.object({
  id: z.string().min(1), kind: z.literal("validate"), position: zPosition,
  data: z.object({ name: z.string().min(1), severity: z.enum(["info", "warn", "block"]).default("warn"), rule: zRule }),
});
const zDocBlock = z.discriminatedUnion("type", [
  z.object({ type: z.literal("heading"), text: z.string() }),
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("table"), rows: z.array(z.array(z.string())) }),
]);
const zDoc = z.object({ brandColor: z.string().optional(), logo: z.string().optional(), blocks: z.array(zDocBlock).default([]) });
const zGenerate = z.object({
  id: z.string().min(1), kind: z.literal("generate"), position: zPosition,
  data: z.object({ templateKey: z.string().min(1), name: z.string().min(1), body: z.string().default(""), doc: zDoc.optional(), html: z.string().optional() }),
});

const zNode = z.discriminatedUnion("kind", [zIntake, zExtract, zValidate, zGenerate]);
const zEdge = z.object({ id: z.string().min(1), source: z.string().min(1), target: z.string().min(1) });

export const flowGraphSchema = z.object({
  nodes: z.array(zNode).max(200),
  edges: z.array(zEdge).max(400),
});

export type FlowGraph = z.infer<typeof flowGraphSchema>;
export type FlowNode = z.infer<typeof zNode>;
export type FlowEdge = z.infer<typeof zEdge>;
export type FlowField = z.infer<typeof zField>;

// ── Compilation: graph → engine config ────────────────────────────────
export interface CompiledFlow {
  docTypes: Array<{ key: string; name: string; hint: string | null }>;
  fieldsByType: Record<string, FlowField[]>;
  rules: Array<{ name: string; severity: Severity; appliesTo: string; conditionsJson: ValidationRule }>;
  template: { key: string; name: string; body: string; doc?: ContractDoc; html?: string } | null;
}

export function compileFlow(graph: FlowGraph): CompiledFlow {
  const docTypes: CompiledFlow["docTypes"] = [];
  const fieldsByType: Record<string, FlowField[]> = {};
  const rules: CompiledFlow["rules"] = [];
  let template: CompiledFlow["template"] = null;

  for (const n of graph.nodes) {
    if (n.kind === "intake") {
      docTypes.push({ key: n.data.docTypeKey, name: n.data.name, hint: n.data.hint ?? null });
    } else if (n.kind === "extract") {
      (fieldsByType[n.data.docTypeKey] ??= []).push(...n.data.fields);
    } else if (n.kind === "validate") {
      const rule = n.data.rule as ValidationRule;
      rules.push({ name: n.data.name, severity: n.data.severity, appliesTo: ruleRefs(rule)[0]?.field ?? rule.kind, conditionsJson: rule });
    } else if (n.kind === "generate") {
      if (!template) template = { key: n.data.templateKey, name: n.data.name, body: n.data.body, doc: n.data.doc as ContractDoc | undefined, html: n.data.html };
    }
  }
  return { docTypes, fieldsByType, rules, template };
}

// ── Execution order ───────────────────────────────────────────────────
// Kahn topological sort so the engine runs stages in dependency order.
// Nodes left in a cycle are appended in input order (the graph validator
// rejects cycles, so this is just a safety net).
export function topoOrder(graph: FlowGraph): FlowNode[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const indeg = new Map<string, number>(graph.nodes.map((n) => [n.id, 0]));
  const adj = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue;
    adj.set(e.source, [...(adj.get(e.source) ?? []), e.target]);
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
  }
  const queue = graph.nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id);
  const out: FlowNode[] = [];
  const seen = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(byId.get(id)!);
    for (const t of adj.get(id) ?? []) {
      indeg.set(t, (indeg.get(t) ?? 1) - 1);
      if ((indeg.get(t) ?? 0) <= 0) queue.push(t);
    }
  }
  for (const n of graph.nodes) if (!seen.has(n.id)) out.push(n);
  return out;
}

// Detects a cycle via Kahn's algorithm: if fewer nodes than exist can be
// dequeued with zero remaining in-degree, the leftover set forms a cycle.
export function hasCycle(graph: FlowGraph): boolean {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const indeg = new Map<string, number>(graph.nodes.map((n) => [n.id, 0]));
  const adj = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue;
    adj.set(e.source, [...(adj.get(e.source) ?? []), e.target]);
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
  }
  const queue = graph.nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id);
  const seen = new Set<string>();
  let visited = 0;
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id); visited++;
    for (const t of adj.get(id) ?? []) {
      indeg.set(t, (indeg.get(t) ?? 1) - 1);
      if ((indeg.get(t) ?? 0) <= 0) queue.push(t);
    }
  }
  return visited !== graph.nodes.length;
}

// Reject rules that reference a doc type with no intake node, or a field that
// no extract node produces — the most common way a hand-built flow breaks.
// Returns an error message, or null when references are consistent.
export function validateFlowReferences(graph: FlowGraph): string | null {
  const intakeTypes = new Set<string>();
  for (const n of graph.nodes) if (n.kind === "intake") intakeTypes.add(n.data.docTypeKey);

  const fieldsByType: Record<string, Set<string>> = {};
  for (const n of graph.nodes) if (n.kind === "extract") {
    (fieldsByType[n.data.docTypeKey] ??= new Set());
    for (const f of n.data.fields) fieldsByType[n.data.docTypeKey].add(f.fieldKey);
  }

  const checkRef = (ref: { docType: string; field: string }, where: string): string | null => {
    if (!intakeTypes.has(ref.docType)) return `La regla referencia el tipo "${ref.docType}" (${where}) que no tiene nodo de entrada.`;
    if (fieldsByType[ref.docType] && !fieldsByType[ref.docType].has(ref.field)) {
      return `El campo "${ref.field}" de "${ref.docType}" (${where}) no lo produce ningún nodo de extracción.`;
    }
    return null;
  };

  for (const n of graph.nodes) {
    if (n.kind !== "validate") continue;
    const rule = n.data.rule as ValidationRule;
    for (const ref of ruleRefs(rule)) {
      const err = checkRef(ref, `regla "${n.data.name}"`);
      if (err) return err;
    }
    if (rule.kind === "document_required") {
      const missing = rule.docTypes.find((t) => !intakeTypes.has(t));
      if (missing) return `La regla "${n.data.name}" exige el documento "${missing}" que no tiene nodo de entrada.`;
    }
  }
  return null;
}

// ── Preset → default flow graph ───────────────────────────────────────
// Turns a playbook preset into a ready-made canvas the client can edit:
// one intake+extract column per doc type, validate nodes fed by all extracts,
// and a final generate node.
export function presetToFlow(preset: ContractPreset): FlowGraph {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const COL = 280, ROW = 190;

  preset.docTypes.forEach((dt, i) => {
    const intakeId = `intake_${dt.key}`;
    const extractId = `extract_${dt.key}`;
    nodes.push({ id: intakeId, kind: "intake", position: { x: 0, y: i * ROW }, data: { docTypeKey: dt.key, name: dt.name, hint: dt.hint ?? null } });
    nodes.push({ id: extractId, kind: "extract", position: { x: COL, y: i * ROW }, data: { docTypeKey: dt.key, fields: dt.fields.map((f) => ({ fieldKey: f.key, label: f.label, isList: !!f.isList })) } });
    edges.push({ id: `e_${intakeId}_${extractId}`, source: intakeId, target: extractId });
  });

  const validateIds: string[] = [];
  preset.rules.forEach((r, i) => {
    const id = `validate_${i}`;
    validateIds.push(id);
    nodes.push({ id, kind: "validate", position: { x: COL * 2, y: i * ROW }, data: { name: r.name, severity: "block", rule: r.conditions as ValidationRule } });
    preset.docTypes.forEach((dt) => edges.push({ id: `e_extract_${dt.key}_${id}`, source: `extract_${dt.key}`, target: id }));
  });

  const genId = "generate_out";
  nodes.push({ id: genId, kind: "generate", position: { x: COL * 3, y: 0 }, data: { templateKey: preset.template.key, name: preset.template.name, body: preset.template.body } });
  const genSources = validateIds.length ? validateIds : preset.docTypes.map((dt) => `extract_${dt.key}`);
  genSources.forEach((src) => edges.push({ id: `e_${src}_${genId}`, source: src, target: genId }));

  return { nodes, edges };
}
