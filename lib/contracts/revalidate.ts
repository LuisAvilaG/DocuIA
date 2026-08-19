import { db } from "@/lib/db";
import { contractCases, contractDocuments, contractValidations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { isFeatureEnabled } from "@/lib/features";
import { loadContractPlan } from "./plan";
import { caseVerdict, runValidations, type DocsByType } from "./validate";

/** Re-runs validations after a reviewed extraction value is corrected. */
export async function revalidateContractCase(caseId: string): Promise<void> {
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
      values: (document.extractedJson ?? {}) as Record<string, unknown>,
      citations: (document.citationsJson ?? {}) as Record<string, unknown>,
    });
  }

  const validations = validationsEnabled ? runValidations(plan.rules, docsByType, new Date()) : [];
  const verdict = caseVerdict(validations);
  await db.delete(contractValidations).where(eq(contractValidations.caseId, caseId));
  if (validations.length > 0) {
    await db.insert(contractValidations).values(validations.map((validation) => ({
      caseId,
      ruleName: validation.ruleName,
      severity: validation.severity,
      subject: validation.subject,
      status: validation.status,
      ok: validation.ok,
      reason: validation.reason,
      checksJson: validation.checks,
      citation: validation.citation,
    })));
  }

  const previousResult = (kase.resultJson && typeof kase.resultJson === "object" && !Array.isArray(kase.resultJson))
    ? kase.resultJson as Record<string, unknown>
    : {};
  await db.update(contractCases).set({
    status: "validated",
    resultJson: { ...previousResult, validations: validations.length, verdict },
    updatedAt: new Date(),
  }).where(eq(contractCases.id, caseId));
}
