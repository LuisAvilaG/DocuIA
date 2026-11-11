// Versiones de flujo (feature contract_flow_versions): borrador, publicación con
// nota y lista de cambios, historial acotado y casos abiertos al publicar.
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { contractCases, contractFlowVersions, contractFlows, orgUsers } from "@/db/schema";
import { getFeature } from "@/lib/features";
import { flowGraphSchema, hasCycle, validateFlowReferences, type FlowGraph } from "./flow";
import { diffFlows } from "./flow-diff";

export async function flowVersionsConfig(orgId: string): Promise<{ enabled: boolean; maxVersions: number; testCases: number }> {
  const f = await getFeature(orgId, "contract_flow_versions").catch(() => null);
  return {
    enabled: Boolean(f?.isEnabled),
    maxVersions: Math.min(100, Math.max(2, Number(f?.config.max_versions) || 20)),
    testCases: Math.min(20, Math.max(1, Number(f?.config.test_cases) || 5)),
  };
}

export async function listFlowVersions(orgId: string, flowId: string, limit = 20) {
  const rows = await db.select().from(contractFlowVersions)
    .where(and(eq(contractFlowVersions.organizationId, orgId), eq(contractFlowVersions.flowId, flowId)))
    .orderBy(desc(contractFlowVersions.version)).limit(limit);
  const ids = [...new Set(rows.map((r) => r.publishedBy).filter((x): x is string => Boolean(x)))];
  const users = ids.length ? await db.query.orgUsers.findMany({ where: inArray(orgUsers.id, ids), columns: { id: true, fullName: true, email: true } }) : [];
  const name = new Map(users.map((u) => [u.id, u.fullName || u.email]));
  return rows.map((r) => ({
    version: r.version, note: r.note, publishedAt: r.publishedAt.toISOString(),
    publishedBy: r.publishedBy ? name.get(r.publishedBy) ?? null : null,
    changes: Array.isArray(r.changesJson) ? (r.changesJson as string[]) : [],
  }));
}

/** Errores de un grafo antes de guardarlo o publicarlo (null si es válido). */
export function graphProblem(graph: FlowGraph): string | null {
  if (hasCycle(graph)) return "El flujo tiene un ciclo; las conexiones deben ir en una sola dirección.";
  return validateFlowReferences(graph);
}

export type PublishResult =
  | { ok: true; version: number; changes: string[]; reanalyzeIds: string[] }
  | { ok: false; status: number; error: string };

export async function publishFlow(input: { orgId: string; userId: string; flowId: string; expectedVersion: number | null; note: string; reanalyze: boolean; maxVersions: number }): Promise<PublishResult> {
  return db.transaction(async (tx) => {
    const [flow] = await tx.select().from(contractFlows)
      .where(and(eq(contractFlows.id, input.flowId), eq(contractFlows.organizationId, input.orgId))).for("update");
    if (!flow) return { ok: false, status: 404, error: "Flujo no encontrado" };
    if (input.expectedVersion !== null && input.expectedVersion !== flow.version) {
      return { ok: false, status: 409, error: "Otra persona publicó este flujo mientras lo editabas. Recarga la página." };
    }
    const draft = flowGraphSchema.safeParse(flow.draftJson);
    if (!flow.draftJson || !draft.success) return { ok: false, status: 400, error: "No hay un borrador para publicar. Guarda los cambios primero." };
    const problem = graphProblem(draft.data);
    if (problem) return { ok: false, status: 400, error: problem };

    const current = flowGraphSchema.safeParse(flow.graphJson);
    const changes = diffFlows(current.success ? current.data : null, draft.data);
    if (changes.length === 0) return { ok: false, status: 400, error: "El borrador es igual a la versión publicada." };
    const version = flow.version + 1;

    await tx.update(contractFlows).set({ graphJson: draft.data, version, draftJson: null, draftUpdatedAt: null, updatedAt: new Date() })
      .where(eq(contractFlows.id, flow.id));
    await tx.insert(contractFlowVersions).values({
      organizationId: input.orgId, flowId: flow.id, version, name: flow.name, graphJson: draft.data,
      note: input.note || null, changesJson: changes, publishedBy: input.userId,
    });
    // Solo se guardan las últimas N versiones.
    await tx.delete(contractFlowVersions).where(and(eq(contractFlowVersions.flowId, flow.id), lt(contractFlowVersions.version, version - input.maxVersions + 1)));

    let reanalyzeIds: string[] = [];
    if (input.reanalyze) {
      const open = await tx.update(contractCases).set({ status: "uploaded", updatedAt: new Date() })
        .where(and(eq(contractCases.organizationId, input.orgId), eq(contractCases.flowId, flow.id), inArray(contractCases.status, ["review", "validated"])))
        .returning({ id: contractCases.id });
      reanalyzeIds = open.map((c) => c.id);
    }
    return { ok: true, version, changes, reanalyzeIds };
  });
}
