import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { contractCases, contractDocuments, contractFlows, orgUsers } from "@/db/schema";
import { canApprove } from "@/lib/auth/permissions";
import { getFeature } from "@/lib/features";
import { flowGraphSchema } from "./flow";
import { newestFirst } from "./validate";
import { requiredSteps, type ApprovalNodeData, type ApprovalRecord, type ApprovalStep } from "./approval-rules";

export interface CaseApprovalRules {
  node: ApprovalNodeData;
  steps: ApprovalStep[];
  done: ApprovalRecord[];
  noSelfApproval: boolean;
  reminderBusinessDays: number;
}

/** Reglas de aprobación del caso si la feature está activa y su flujo tiene la etapa; si no, null. */
export async function caseApprovalRules(organizationId: string, caseId: string): Promise<CaseApprovalRules | null> {
  const feature = await getFeature(organizationId, "contract_approval_rules").catch(() => null);
  if (!feature?.isEnabled) return null;
  const kase = await db.query.contractCases.findFirst({
    where: and(eq(contractCases.id, caseId), eq(contractCases.organizationId, organizationId)),
    columns: { flowId: true, resultJson: true },
  });
  if (!kase?.flowId) return null;
  // El caso se decide con el flujo con el que se analizó (resultJson.flow.snapshot):
  // editar o publicar el flujo no cambia quién aprueba un caso en curso. El flujo
  // vigente solo se usa si el caso no guardó esa copia.
  const snapshot = (kase.resultJson as { flow?: { snapshot?: { flowId?: unknown; graph?: unknown } } } | null)?.flow?.snapshot;
  let graph = snapshot?.flowId ? flowGraphSchema.safeParse(snapshot.graph) : null;
  if (!graph?.success) {
    const flow = await db.query.contractFlows.findFirst({ where: and(eq(contractFlows.id, kase.flowId), eq(contractFlows.organizationId, organizationId)), columns: { graphJson: true } });
    graph = flow ? flowGraphSchema.safeParse(flow.graphJson) : null;
  }
  const node = graph?.success ? graph.data.nodes.find((n) => n.kind === "approval") : undefined;
  if (!node || node.kind !== "approval") return null;

  const docs = await db.query.contractDocuments.findMany({ where: eq(contractDocuments.caseId, caseId), columns: { id: true, createdAt: true, detectedType: true, extractedJson: true } });
  const byType: Record<string, Array<{ values: Record<string, unknown> }>> = {};
  // Same order as validations: the newest document of a type gives the amount.
  for (const d of newestFirst(docs)) if (d.detectedType) (byType[d.detectedType] ??= []).push({ values: (d.extractedJson ?? {}) as Record<string, unknown> });
  const result = (kase.resultJson ?? {}) as { approvals?: ApprovalRecord[] };
  // A step names people. If none of them can sign any more (they left, lost the
  // permission, or the flow came from another client), nobody could: the case
  // stayed "Por decidir" and could only be rejected. The client's
  // administrators sign it then, the strictest stand-in there is.
  const people = await db.query.orgUsers.findMany({
    where: and(eq(orgUsers.organizationId, organizationId), eq(orgUsers.isActive, true)),
    columns: { id: true, role: true },
  });
  const signers = new Set(people.filter((p) => canApprove(p.role, "contracts")).map((p) => p.id));
  const admins = people.filter((p) => p.role === "admin").map((p) => p.id);
  const steps = requiredSteps(node.data, byType).map((step) => {
    if (step.approvers.mode !== "users") return step;
    const userIds = step.approvers.userIds.filter((id) => signers.has(id));
    if (userIds.length) return { ...step, approvers: { mode: "users" as const, userIds } };
    return admins.length ? { ...step, label: `${step.label} (lo firma un administrador)`, approvers: { mode: "users" as const, userIds: admins } } : step;
  });
  return {
    node: node.data,
    steps,
    done: Array.isArray(result.approvals) ? result.approvals : [],
    noSelfApproval: feature.config.no_self_approval !== false,
    reminderBusinessDays: Math.max(0, Number(feature.config.reminder_business_days) || 0),
  };
}
