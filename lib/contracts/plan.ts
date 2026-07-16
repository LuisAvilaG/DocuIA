import { db } from "@/lib/db";
import { contractFlows, contractValidationRules, contractOutputTemplates, orgProducts } from "@/db/schema";
import { and, eq, asc, desc, count } from "drizzle-orm";
import { getContractConfig } from "./config";
import { compileFlow, flowGraphSchema, type FlowGraph } from "./flow";
import type { FieldDef } from "./extract";
import type { Severity } from "./validate";
import type { ContractDoc } from "./generate";

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
  flow:         FlowGraph | null;
  docTypes:     Array<{ key: string; name: string; hint: string | null }>;
  fieldsByType: Record<string, FieldDef[]>;
  rules:        Array<{ name: string; severity?: Severity; conditionsJson: unknown }>;
  template:     { key: string; name: string; body: string; doc?: ContractDoc; html?: string } | null;
}

// Resolve a flow to run: the one the client picked (flowId) if it belongs to the
// org, otherwise the most recently updated flow. Returns null if none parse.
export async function getActiveFlow(orgId: string, flowId?: string | null): Promise<{ id: string; name: string; graph: FlowGraph } | null> {
  const row = flowId
    ? await db.query.contractFlows.findFirst({ where: and(eq(contractFlows.id, flowId), eq(contractFlows.organizationId, orgId)) })
    : await db.query.contractFlows.findFirst({
        where: and(eq(contractFlows.organizationId, orgId), eq(contractFlows.isActive, true)),
        orderBy: [desc(contractFlows.updatedAt)],
      });
  if (!row) {
    // A stale/foreign flowId falls back to the org's most recent flow.
    return flowId ? getActiveFlow(orgId, null) : null;
  }
  const parsed = flowGraphSchema.safeParse(row.graphJson);
  if (!parsed.success) return null;
  return { id: row.id, name: row.name, graph: parsed.data };
}

export async function loadContractPlan(orgId: string, flowId?: string | null): Promise<ContractPlan> {
  const active = await getActiveFlow(orgId, flowId);
  if (active) {
    const c = compileFlow(active.graph);
    return {
      source: "flow",
      flow: active.graph,
      docTypes: c.docTypes,
      fieldsByType: c.fieldsByType,
      rules: c.rules.map((r) => ({ name: r.name, severity: r.severity, conditionsJson: r.conditionsJson })),
      template: c.template,
    };
  }

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
    flow: null,
    docTypes: config.docTypes.map((d) => ({ key: d.key, name: d.name, hint: d.hint ?? null })),
    fieldsByType: config.fieldsByType,
    rules: rules.map((r) => ({ name: r.name, conditionsJson: r.conditionsJson })),
    template: templates[0] ? { key: templates[0].key, name: templates[0].name, body: templates[0].body } : null,
  };
}
