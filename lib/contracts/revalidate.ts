import { db } from "@/lib/db";
import { contractCases, contractDocuments } from "@/db/schema";
import { eq } from "drizzle-orm";
import { isFeatureEnabled } from "@/lib/features";
import { loadContractPlan } from "./plan";
import { caseVerdict, runValidations, type DocsByType } from "./validate";

export interface ContractRevalidation {
  caseId: string;
  validations: ReturnType<typeof runValidations>;
  verdict: ReturnType<typeof caseVerdict>;
  resultJson: Record<string, unknown>;
}

/** Calculates the result using optional reviewed document values, without writing. */
export async function calculateContractRevalidation(
  caseId: string,
  overrides: Record<string, Record<string, unknown>> = {},
): Promise<ContractRevalidation> {
  const kase = await db.query.contractCases.findFirst({ where: eq(contractCases.id, caseId) });
  if (!kase) throw new Error("Caso no encontrado");

  const [documents, plan, validationsEnabled] = await Promise.all([
    db.query.contractDocuments.findMany({ where: eq(contractDocuments.caseId, caseId) }),
    loadContractPlan(kase.organizationId, kase.flowId),
    isFeatureEnabled(kase.organizationId, "contract_advanced_validations"),
  ]);

  const docsByType: DocsByType = {};
  for (const document of documents) {
    if (!document.detectedType) continue;
    (docsByType[document.detectedType] ??= []).push({
      values: overrides[document.id] ?? (document.extractedJson ?? {}) as Record<string, unknown>,
      citations: (document.citationsJson ?? {}) as Record<string, unknown>,
    });
  }

  const validations = validationsEnabled ? runValidations(plan.rules, docsByType, new Date()) : [];
  const verdict = caseVerdict(validations);
  const previousResult = (kase.resultJson && typeof kase.resultJson === "object" && !Array.isArray(kase.resultJson))
    ? kase.resultJson as Record<string, unknown>
    : {};
  return { caseId, validations, verdict, resultJson: { ...previousResult, validations: validations.length, verdict } };
}
