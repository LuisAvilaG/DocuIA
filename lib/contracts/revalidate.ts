import { orgTimeZone } from "@/lib/org-time-zone";
import { wallClockIn } from "@/lib/time-zone";
import { db } from "@/lib/db";
import { contractAiAnalysisResults, contractCases, contractDocuments } from "@/db/schema";
import { eq } from "drizzle-orm";
import { isFeatureEnabled } from "@/lib/features";
import { loadCasePlan, type ContractPlan } from "./plan";
import type { DocsByType, Severity, ValidationResult } from "./validate";
import { assembleResults, isAiRule, type AnalysisOutcome } from "./assemble";
import { adoptParts, evaluateCalculations, type CalculationResult } from "./calculations";
import type { AiAnalysisItem, AiAnalysisOutcome } from "./ai-analysis";
import { archiveValidationsForCase } from "./archive-validations";
import { caseVerdict } from "./validate";

export interface ContractRevalidation {
  caseId: string;
  /** Documentos del caso (para ubicar la evidencia por página). */
  documentIds: string[];
  /** Controles con IA del plan que no tienen un análisis guardado (no se evaluaron). */
  untestedAi: number;
  validations: ValidationResult[];
  verdict: ReturnType<typeof assembleResults>["verdict"];
  resultJson: Record<string, unknown>;
}

type StoredDocument = { id: string; detectedType: string | null; extractedJson: unknown; citationsJson: unknown };
type StoredAnalysis = { ruleName: string; severity: string; outputMode: string; outcome: string; summary: string | null; itemsJson: unknown; citationsJson: unknown };

function docsByTypeOf(documents: StoredDocument[], overrides: Record<string, Record<string, unknown>> = {}): DocsByType {
  const docsByType: DocsByType = {};
  for (const document of documents) {
    if (!document.detectedType) continue;
    (docsByType[document.detectedType] ??= []).push({
      values: overrides[document.id] ?? (document.extractedJson ?? {}) as Record<string, unknown>,
      citations: (document.citationsJson ?? {}) as Record<string, unknown>,
      documentId: document.id,
    });
  }
  return docsByType;
}

// Stored rows carry the rule name; the flow's AI nodes give back the node id
// that calculations use to read analysis items.
function storedOutcomes(plan: ContractPlan, rows: StoredAnalysis[], onlyInPlan: boolean): AnalysisOutcome[] {
  const nodeByRule = new Map(plan.rules.filter(isAiRule).map((rule) => [rule.name, rule.nodeId]));
  return rows.filter((row) => !onlyInPlan || nodeByRule.has(row.ruleName)).map((row) => ({
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
}

/**
 * Stored calculations with their operation ("base × factor"), for cases
 * analysed before it was kept: evaluated again from what is saved, without
 * writing, and adopted only where the result is the same number.
 */
export async function calculationsWithOperation(
  kase: { organizationId: string; flowId: string | null; resultJson: unknown },
  stored: CalculationResult[],
  documents: StoredDocument[],
  analyses: StoredAnalysis[],
): Promise<CalculationResult[]> {
  if (stored.every((item) => item.parts)) return stored;
  const plan = await loadCasePlan(kase);
  const analysisItems = Object.fromEntries(storedOutcomes(plan, analyses, false)
    .filter((analysis) => analysis.nodeId)
    .map((analysis) => [analysis.nodeId!, analysis.response.items]));
  const fresh = evaluateCalculations(plan.calculations, docsByTypeOf(documents), analysisItems);
  return stored.map((item) => adoptParts(item, fresh.find((candidate) => candidate.key === item.key)));
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
  opts: { plan?: ContractPlan } = {},
): Promise<ContractRevalidation> {
  const kase = await db.query.contractCases.findFirst({ where: eq(contractCases.id, caseId) });
  if (!kase) throw new Error("Caso no encontrado");

  const [documents, plan, validationsEnabled, storedAnalyses] = await Promise.all([
    db.query.contractDocuments.findMany({ where: eq(contractDocuments.caseId, caseId) }),
    opts.plan ?? loadCasePlan(kase),
    isFeatureEnabled(kase.organizationId, "contract_advanced_validations"),
    db.query.contractAiAnalysisResults.findMany({ where: eq(contractAiAnalysisResults.caseId, caseId) }),
  ]);

  const docsByType = docsByTypeOf(documents, overrides);
  // Con otro plan (probar un borrador) solo cuentan los análisis de controles que siguen en él.
  const analyses = storedOutcomes(plan, storedAnalyses, Boolean(opts.plan));

  const assembled = assembleResults(plan, docsByType, analyses, { validationsEnabled, now: wallClockIn(await orgTimeZone(kase.organizationId)) });
  const refNode = plan.flow?.nodes.find((node) => node.kind === "reference_lookup");
  const validations = refNode
    ? [...assembled.validations, ...await archiveValidationsForCase({ organizationId: kase.organizationId, caseDocumentIds: documents.map((document) => document.id), name: refNode.data.name, severity: refNode.data.severity })]
    : assembled.validations;
  const { calculations, calculationValues } = assembled;
  const verdict = caseVerdict(validations);
  const previousResult = (kase.resultJson && typeof kase.resultJson === "object" && !Array.isArray(kase.resultJson))
    ? kase.resultJson as Record<string, unknown>
    : {};
  // Las firmas parciales valen para los datos que se firmaron: si se corrige un
  // campo o cambia el veredicto (p. ej. por una referencia del Archivo), se piden de nuevo.
  const carried: Record<string, unknown> = { ...previousResult };
  const changed = Object.keys(overrides).length > 0 || (previousResult.verdict !== undefined && previousResult.verdict !== verdict);
  if (changed && Array.isArray(carried.approvals) && carried.approvals.length > 0) {
    carried.approvalsReset = { at: new Date().toISOString(), count: carried.approvals.length };
    delete carried.approvals;
  }
  const analyzed = new Set(storedAnalyses.map((row) => row.ruleName));
  return {
    caseId,
    documentIds: documents.map((document) => document.id),
    untestedAi: plan.rules.filter(isAiRule).filter((rule) => !analyzed.has(rule.name)).length,
    validations,
    verdict,
    resultJson: { ...carried, validations: validations.length, calculations, calculationValues, verdict },
  };
}
