import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { contractCases, contractDocuments, contractFlows } from "@/db/schema";
import { getFeature } from "@/lib/features";
import { flowGraphSchema } from "./flow";
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
  const flow = await db.query.contractFlows.findFirst({ where: and(eq(contractFlows.id, kase.flowId), eq(contractFlows.organizationId, organizationId)), columns: { graphJson: true } });
  const graph = flow ? flowGraphSchema.safeParse(flow.graphJson) : null;
  const node = graph?.success ? graph.data.nodes.find((n) => n.kind === "approval") : undefined;
  if (!node || node.kind !== "approval") return null;

  const docs = await db.query.contractDocuments.findMany({ where: eq(contractDocuments.caseId, caseId), columns: { detectedType: true, extractedJson: true } });
  const byType: Record<string, Array<{ values: Record<string, unknown> }>> = {};
  for (const d of docs) if (d.detectedType) (byType[d.detectedType] ??= []).push({ values: (d.extractedJson ?? {}) as Record<string, unknown> });
  const result = (kase.resultJson ?? {}) as { approvals?: ApprovalRecord[] };
  return {
    node: node.data,
    steps: requiredSteps(node.data, byType),
    done: Array.isArray(result.approvals) ? result.approvals : [],
    noSelfApproval: feature.config.no_self_approval !== false,
    reminderBusinessDays: Math.max(0, Number(feature.config.reminder_business_days) || 0),
  };
}
