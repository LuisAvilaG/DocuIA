import { runValidations, caseVerdict, type DocsByType, type ValidationResult } from "./validate";
import { evaluateCalculations, type CalculationResult } from "./calculations";
import type { ContractPlan } from "./plan";
import type { AiAnalysisResponse, AiAnalysisRule } from "./ai-analysis";

export interface AnalysisOutcome {
  nodeId?: string;
  ruleName: string;
  severity: "info" | "warn" | "block";
  outputMode: string;
  response: AiAnalysisResponse;
}

export function isAiRule(rule: ContractPlan["rules"][number]): rule is ContractPlan["rules"][number] & { conditionsJson: AiAnalysisRule } {
  return (rule.conditionsJson as { kind?: unknown } | null)?.kind === "ai_analysis";
}

/** Compact outcome of an AI analysis that joins the regular verdict and approval gate. */
export function aiValidation(analysis: AnalysisOutcome): ValidationResult {
  const { outcome, summary, items, citations } = analysis.response;
  return {
    ruleName: analysis.ruleName,
    // An explicit block from the governed prompt must remain a block even
    // if the node was originally configured as a softer review rule.
    severity: outcome === "block" ? "block" : analysis.severity,
    subject: "Análisis con IA",
    status: outcome === "pass" ? "sin observaciones" : outcome === "block" ? "bloqueado" : "requiere revisión",
    ok: outcome === "pass" ? true : outcome === "block" ? false : null,
    reason: summary ?? (items.length > 0 ? `${items.length} hallazgo(s) estructurado(s).` : "El análisis requiere revisión."),
    checks: [],
    citation: citations[0] ?? null,
  };
}

export interface AssembledResults {
  validations: ValidationResult[];
  calculations: CalculationResult[];
  calculationValues: Record<string, unknown>;
  verdict: ReturnType<typeof caseVerdict>;
}

/**
 * Deterministic rules + AI outcomes + calculations for a case. Used both when
 * a case is processed and when a reviewer corrects a field, so a correction
 * can neither drop AI blocks nor leave calculations on the old values.
 */
export function assembleResults(
  plan: ContractPlan,
  docsByType: DocsByType,
  analyses: AnalysisOutcome[],
  { validationsEnabled, now = new Date() }: { validationsEnabled: boolean; now?: Date },
): AssembledResults {
  const regularRules = plan.rules.filter((rule) => !isAiRule(rule));
  const baseValidations = validationsEnabled ? runValidations(regularRules, docsByType, now) : [];

  // Calculations run after structured AI analyses so a generic calculation can
  // use an analysis item as input, while the model never does arithmetic.
  const analysisItemsByNode = Object.fromEntries(analyses
    .filter((analysis) => analysis.nodeId)
    .map((analysis) => [analysis.nodeId!, analysis.response.items]));
  const calculations = evaluateCalculations(plan.calculations, docsByType, analysisItemsByNode);
  const calculationValues = Object.fromEntries(calculations.map((item) => [item.key,
    item.items?.map((entry) => ({ ...entry.values, value: entry.value, status: entry.status, evidence: entry.evidence ?? null })) ?? item.value,
  ]));

  const validations = [...baseValidations, ...(validationsEnabled ? analyses.map(aiValidation) : [])];
  return { validations, calculations, calculationValues, verdict: caseVerdict(validations) };
}
