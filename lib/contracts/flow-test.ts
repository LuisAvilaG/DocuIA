// «Probar con casos anteriores»: corre el borrador sobre los últimos casos del
// flujo con los valores y análisis ya guardados (sin llamar a la IA) y compara
// el resultado con el que tuvieron.
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { contractCases } from "@/db/schema";
import { planFromFlow } from "./plan";
import { calculateContractRevalidation } from "./revalidate";
import type { FlowGraph } from "./flow";
import type { ValidationResult } from "./validate";

type Verdict = "ok" | "warn" | "block";

export interface FlowTestCase {
  id: string;
  title: string;
  before: Verdict;
  after: Verdict;
  /** Controles que fallan con el borrador y antes no. */
  newIssues: string[];
  /** Controles que fallaban y con el borrador ya no. */
  resolved: string[];
  untestedAi: number;
  error?: string;
}

const failing = (validations: ValidationResult[]) => new Set(validations.filter((v) => v.ok !== true && v.severity !== "info").map((v) => v.ruleName));

/** Compara controles que fallan antes y después. Exportado para pruebas. */
export function compareValidations(before: ValidationResult[], after: ValidationResult[]): { newIssues: string[]; resolved: string[] } {
  const a = failing(before), b = failing(after);
  return { newIssues: [...b].filter((n) => !a.has(n)), resolved: [...a].filter((n) => !b.has(n)) };
}

export async function testDraftOnCases(orgId: string, flowId: string, draft: FlowGraph, limit: number): Promise<FlowTestCase[]> {
  const cases = await db.query.contractCases.findMany({
    where: and(eq(contractCases.organizationId, orgId), eq(contractCases.flowId, flowId), inArray(contractCases.status, ["review", "validated", "approved", "rejected", "awaiting_documents"])),
    orderBy: [desc(contractCases.updatedAt)], limit,
    columns: { id: true, title: true },
  });
  const plan = planFromFlow(flowId, draft);
  const out: FlowTestCase[] = [];
  for (const c of cases) {
    const title = c.title || "Caso sin título";
    try {
      const [before, after] = [await calculateContractRevalidation(c.id), await calculateContractRevalidation(c.id, {}, { plan })];
      out.push({ id: c.id, title, before: before.verdict, after: after.verdict, ...compareValidations(before.validations, after.validations), untestedAi: after.untestedAi });
    } catch (e) {
      out.push({ id: c.id, title, before: "ok", after: "ok", newIssues: [], resolved: [], untestedAi: 0, error: e instanceof Error ? e.message : "No se pudo probar" });
    }
  }
  return out;
}
