import { db } from "@/lib/db";
import { contractFlows, contractValidationRules, contractOutputTemplates, orgProducts } from "@/db/schema";
import { and, eq, asc, desc, count } from "drizzle-orm";
import { getContractConfig } from "./config";
import { compileFlow, flowGraphSchema, type FlowGraph } from "./flow";
import type { FieldDef } from "./extract";
import type { Severity } from "./validate";
import type { ContractDoc } from "./generate";
import type { WordTemplateConfig } from "./word-template";
import type { CalculationDefinition } from "./calculations";

// Default number of flows a client may have when the superadmin hasn't set one.
export const DEFAULT_MAX_FLOWS = 3;

// Per-client flow quota, stored by the superadmin in the contract product config.
export async function getContractFlowLimit(orgId: string): Promise<number> {
  const row = await db.query.orgProducts.findFirst({
    where: and(eq(orgProducts.organizationId, orgId), eq(orgProducts.productKey, "contract_intelligence")),
    columns: { configJson: true },
  });
  const raw = (row?.configJson as { maxFlows?: unknown } | null)?.maxFlows;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_MAX_FLOWS;
}

export async function getContractFlowCount(orgId: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(contractFlows).where(eq(contractFlows.organizationId, orgId));
  return row?.n ?? 0;
}

// A "plan" is the unified execution config the pipeline runs on. When the org
// has an active flow it is the source of truth (compiled from the node graph);
// otherwise we fall back to the per-table config so nothing breaks.
export interface ContractPlan {
  source:       "flow" | "tables";
  flowId:       string | null;
  flow:         FlowGraph | null;
  docTypes:     Array<{ key: string; name: string; hint: string | null }>;
  fieldsByType: Record<string, FieldDef[]>;
  calculations:  CalculationDefinition[];
  rules:        Array<{ nodeId?: string; name: string; severity?: Severity; conditionsJson: unknown }>;
  template:     { key: string; name: string; body: string; doc?: ContractDoc; html?: string; source?: "editor" | "word"; wordTemplate?: WordTemplateConfig } | null;
}

// Resolve a flow to run: the one the client picked (flowId) if it belongs to the
// org, otherwise the most recently updated flow. Returns null if none parse.
export async function getActiveFlow(orgId: string, flowId?: string | null, { fallback = true } = {}): Promise<{ id: string; name: string; graph: FlowGraph } | null> {
  const row = flowId
    ? await db.query.contractFlows.findFirst({ where: and(eq(contractFlows.id, flowId), eq(contractFlows.organizationId, orgId)) })
    : await db.query.contractFlows.findFirst({
        where: and(eq(contractFlows.organizationId, orgId), eq(contractFlows.isActive, true)),
        orderBy: [desc(contractFlows.updatedAt)],
      });
  if (!row) {
    // A stale/foreign flowId falls back to the org's most recent flow when a
    // new case starts; an existing case must never switch to another flow.
    return flowId && fallback ? getActiveFlow(orgId, null) : null;
  }
  const parsed = flowGraphSchema.safeParse(row.graphJson);
  if (!parsed.success) return null;
  return { id: row.id, name: row.name, graph: parsed.data };
}

function planFromFlow(flowId: string, graph: FlowGraph): ContractPlan {
  const c = compileFlow(graph);
  return {
    source: "flow",
    flowId,
    flow: graph,
    docTypes: c.docTypes,
    fieldsByType: c.fieldsByType,
    calculations: c.calculations,
    rules: c.rules.map((r) => ({ nodeId: r.nodeId, name: r.name, severity: r.severity, conditionsJson: r.conditionsJson })),
    template: c.template,
  };
}

/** Stored on the case when it is processed (resultJson.flow.snapshot). */
export interface FlowSnapshot { flowId: string; graph: FlowGraph }

export function flowSnapshot(plan: ContractPlan): FlowSnapshot | null {
  return plan.flowId && plan.flow ? { flowId: plan.flowId, graph: plan.flow } : null;
}

/**
 * The plan a case was processed with. Generation and corrections must use the
 * same flow even if it was edited, deactivated or deleted afterwards, so the
 * snapshot taken at processing time wins over the live flow.
 */
export async function loadCasePlan(kase: { organizationId: string; flowId: string | null; resultJson: unknown }): Promise<ContractPlan> {
  const snapshot = (kase.resultJson as { flow?: { snapshot?: unknown } } | null)?.flow?.snapshot as Partial<FlowSnapshot> | undefined;
  if (snapshot?.flowId) {
    const parsed = flowGraphSchema.safeParse(snapshot.graph);
    if (parsed.success) return planFromFlow(snapshot.flowId, parsed.data);
  }
  if (kase.flowId) {
    const active = await getActiveFlow(kase.organizationId, kase.flowId, { fallback: false });
    if (!active) throw new Error("El flujo con el que se procesó este caso ya no existe o no es válido. Vuelve a procesarlo con un flujo vigente.");
    return planFromFlow(active.id, active.graph);
  }
  return loadContractPlan(kase.organizationId, null);
}

export async function loadContractPlan(orgId: string, flowId?: string | null): Promise<ContractPlan> {
  const active = await getActiveFlow(orgId, flowId);
  if (active) return planFromFlow(active.id, active.graph);

  const [config, rules, templates] = await Promise.all([
    getContractConfig(orgId),
    db.query.contractValidationRules.findMany({
      where: and(eq(contractValidationRules.organizationId, orgId), eq(contractValidationRules.isActive, true)),
      orderBy: [asc(contractValidationRules.sortOrder)],
    }),
    db.query.contractOutputTemplates.findMany({ where: eq(contractOutputTemplates.organizationId, orgId) }),
  ]);

  return {
    source: "tables",
    flowId: null,
    flow: null,
    docTypes: config.docTypes.map((d) => ({ key: d.key, name: d.name, hint: d.hint ?? null })),
    fieldsByType: config.fieldsByType,
    calculations: [],
    rules: rules.map((r) => ({ name: r.name, conditionsJson: r.conditionsJson })),
    template: templates[0] ? { key: templates[0].key, name: templates[0].name, body: templates[0].body } : null,
  };
}
