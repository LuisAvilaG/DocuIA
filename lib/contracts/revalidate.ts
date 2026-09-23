import { db } from "@/lib/db";
import { contractAiAnalysisResults, contractCases, contractDocuments } from "@/db/schema";
import { eq } from "drizzle-orm";
import { isFeatureEnabled } from "@/lib/features";
import { loadCasePlan } from "./plan";
import type { DocsByType, Severity, ValidationResult } from "./validate";
import { assembleResults, isAiRule, type AnalysisOutcome } from "./assemble";
import type { AiAnalysisItem, AiAnalysisOutcome } from "./ai-analysis";

export interface ContractRevalidation {
  caseId: string;
  validations: ValidationResult[];
  verdict: ReturnType<typeof assembleResults>["verdict"];
  resultJson: Record<string, unknown>;
}

/**
 * Recomputes a case with reviewed document values, without writing. AI
 * analyses are not re-run (a correction must not cost a model call or change
 * its findings): their stored outcomes are kept, so an AI block survives the
 * correction, and calculations are recomputed on the corrected values.
 */
export async function calculateContractRevalidation(
  caseId: string,
  overrides: Record<string, Record<string, unknown>> = {},
): Promise<ContractRevalidation> {
  const kase = await db.query.contractCases.findFirst({ where: eq(contractCases.id, caseId) });
  if (!kase) throw new Error("Caso no encontrado");

  const [documents, plan, validationsEnabled, storedAnalyses] = await Promise.all([
    db.query.contractDocuments.findMany({ where: eq(contractDocuments.caseId, caseId) }),
    loadCasePlan(kase),
    isFeatureEnabled(kase.organizationId, "contract_advanced_validations"),
    db.query.contractAiAnalysisResults.findMany({ where: eq(contractAiAnalysisResults.caseId, caseId) }),
  ]);

  const docsByType: DocsByType = {};
  for (const document of documents) {
    if (!document.detectedType) continue;
    (docsByType[document.detectedType] ??= []).push({
      values: overrides[document.id] ?? (document.extractedJson ?? {}) as Record<string, unknown>,
      citations: (document.citationsJson ?? {}) as Record<string, unknown>,
    });
  }

  // Stored rows carry the rule name; the flow's AI nodes give back the node id
  // that calculations use to read analysis items.
  const nodeByRule = new Map(plan.rules.filter(isAiRule).map((rule) => [rule.name, rule.nodeId]));
  const analyses: AnalysisOutcome[] = storedAnalyses.map((row) => ({
    nodeId: nodeByRule.get(row.ruleName),
    ruleName: row.ruleName,
    severity: row.severity as Severity,
    outputMode: row.outputMode,
    response: {
      outcome: row.outcome as AiAnalysisOutcome,
      summary: row.summary,
      items: Array.isArray(row.itemsJson) ? row.itemsJson as AiAnalysisItem[] : [],
      citations: Array.isArray(row.citationsJson) ? (row.citationsJson as unknown[]).map(String) : [],
    },
  }));

  const { validations, calculations, calculationValues, verdict } = assembleResults(plan, docsByType, analyses, { validationsEnabled });
  const previousResult = (kase.resultJson && typeof kase.resultJson === "object" && !Array.isArray(kase.resultJson))
    ? kase.resultJson as Record<string, unknown>
    : {};
  return {
    caseId,
    validations,
    verdict,
    resultJson: { ...previousResult, validations: validations.length, calculations, calculationValues, verdict },
  };
}
