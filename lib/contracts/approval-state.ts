import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { contractCases, contractDocuments, contractFlows, orgUsers } from "@/db/schema";
import { canApprove } from "@/lib/auth/permissions";
import { getFeature } from "@/lib/features";
import { caseMapRoute, type ApprovalPeople, type MapRoute } from "@/lib/approval-map/state";
import { flowGraphSchema } from "./flow";
import { newestFirst } from "./validate";
import { checkApproval, requiredSteps, type ApprovalNodeData, type ApprovalRecord, type ApprovalStep } from "./approval-rules";

export interface CaseApprovalRules {
  node: ApprovalNodeData;
  steps: ApprovalStep[];
  done: ApprovalRecord[];
  noSelfApproval: boolean;
  reminderBusinessDays: number;
  /** Mapa de aprobaciones: los pasos van en orden y quién firma sale del mapa. */
  ordered?: boolean;
  map?: Omit<MapRoute, "steps">;
}

/**
 * Reglas de aprobación del caso si la feature está activa: las del mapa de
 * aprobaciones asignado a su flujo o, si no tiene, las de la etapa Aprobación
 * del flujo. null si ninguna aplica (decide cualquier aprobador).
 */
export async function caseApprovalRules(organizationId: string, caseId: string, people?: ApprovalPeople): Promise<CaseApprovalRules | null> {
  const feature = await getFeature(organizationId, "contract_approval_rules").catch(() => null);
  if (!feature?.isEnabled) return null;
  const kase = await db.query.contractCases.findFirst({
    where: and(eq(contractCases.id, caseId), eq(contractCases.organizationId, organizationId)),
    columns: { flowId: true, resultJson: true, createdBy: true, updatedAt: true },
  });
  if (!kase?.flowId) return null;

  const docs = await db.query.contractDocuments.findMany({ where: eq(contractDocuments.caseId, caseId), columns: { id: true, createdAt: true, detectedType: true, extractedJson: true } });
  const byType: Record<string, Array<{ values: Record<string, unknown> }>> = {};
  // Same order as validations: the newest document of a type gives the amount.
  for (const d of newestFirst(docs)) if (d.detectedType) (byType[d.detectedType] ??= []).push({ values: (d.extractedJson ?? {}) as Record<string, unknown> });
  const result = (kase.resultJson ?? {}) as { approvals?: ApprovalRecord[] };
  const done = Array.isArray(result.approvals) ? result.approvals : [];

  const mapRoute = await caseMapRoute({ organizationId, ...kase }, byType, people);
  if (mapRoute) {
    const { steps, ...map } = mapRoute;
    return {
      node: { name: map.map.name, base: { mode: "any", userIds: [] }, conditions: [], exceptionUserIds: [] },
      steps, done, map, ordered: true,
      // Quien sube el caso nunca firma su paso: el mapa ya lo pasa a otra persona.
      noSelfApproval: false,
      reminderBusinessDays: map.remindDays,
    };
  }

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

  // A step names people. If none of them can sign any more (they left, lost the
  // permission, or the flow came from another client), nobody could: the case
  // stayed "Por decidir" and could only be rejected. The client's
  // administrators sign it then, the strictest stand-in there is.
  const users = await db.query.orgUsers.findMany({
    where: and(eq(orgUsers.organizationId, organizationId), eq(orgUsers.isActive, true)),
    columns: { id: true, role: true },
  });
  const signers = new Set(users.filter((p) => canApprove(p.role, "contracts")).map((p) => p.id));
  const admins = users.filter((p) => p.role === "admin").map((p) => p.id);
  const steps = requiredSteps(node.data, byType).map((step) => {
    if (step.approvers.mode !== "users") return step;
    const userIds = step.approvers.userIds.filter((id) => signers.has(id));
    if (userIds.length) return { ...step, approvers: { mode: "users" as const, userIds } };
    return admins.length ? { ...step, label: `${step.label} (lo firma un administrador)`, approvers: { mode: "users" as const, userIds: admins } } : step;
  });
  return {
    node: node.data,
    steps,
    done,
    noSelfApproval: feature.config.no_self_approval !== false,
    reminderBusinessDays: Math.max(0, Number(feature.config.reminder_business_days) || 0),
  };
}

/**
 * A quién le toca un caso por decidir: «mine» si esta persona puede firmar
 * ahora, «others» si espera a otra (con a quién), «signed» si ya firmó.
 */
export function caseTurn(rules: CaseApprovalRules | null, user: { id: string; role: string }, creatorId: string | null, blocked: boolean):
  { turn: "mine" | "others" | "signed"; waitingFor: string | null; reason: string | null } {
  if (!canApprove(user.role, "contracts")) return { turn: "others", waitingFor: null, reason: "Tu rol no decide casos." };
  if (!rules) return { turn: "mine", waitingFor: null, reason: null };
  const check = checkApproval({
    steps: rules.steps, done: rules.done, actor: { id: user.id, canApprove: true }, creatorId,
    noSelfApproval: rules.noSelfApproval, blocked, exceptionUserIds: rules.node.exceptionUserIds, ordered: rules.ordered,
  });
  if (check.ok) return { turn: "mine", waitingFor: null, reason: null };
  const next = rules.steps.find((s) => !rules.done.some((d) => d.stepKey === s.key));
  if (rules.done.some((d) => d.byId === user.id)) return { turn: "signed", waitingFor: next?.label ?? null, reason: check.reason };
  return { turn: "others", waitingFor: next?.label ?? null, reason: check.reason };
}
