import { redirect } from "next/navigation";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { getTenantSession } from "@/lib/auth/jwt";
import { isProductActive } from "@/lib/products";
import { isFeatureEnabled } from "@/lib/features";
import { db } from "@/lib/db";
import { contractCases, contractDocuments, contractFlows, contractValidations, statusEvents } from "@/db/schema";
import { ContractMetricsClient } from "./metrics-client";
import { ContractMoreMetrics } from "./more-metrics";
import { loadContractMetrics } from "@/lib/stats/contract-metrics";

// The page works on the most recent cases: without a cap it loaded and sent to
// the browser every case, document and validation the organization ever had.
const MAX_CASES = 5000;

export default async function ContractMetricsPage() {
  const session = await getTenantSession({ area: "contracts" });
  if (!session) redirect("/login");
  if (!(await isProductActive(session.orgId, "contract_intelligence"))) redirect("/dashboard");
  if (!(await isFeatureEnabled(session.orgId, "contract_metrics"))) redirect("/contracts/dashboard");

  const org = eq(contractCases.organizationId, session.orgId);
  const [found, flows, more, approvalEnabled] = await Promise.all([
    db.query.contractCases.findMany({
      where: org,
      columns: { id: true, createdAt: true, updatedAt: true, status: true, flowId: true },
      orderBy: [desc(contractCases.createdAt)],
      limit: MAX_CASES + 1,
    }),
    db.query.contractFlows.findMany({ where: eq(contractFlows.organizationId, session.orgId), columns: { id: true, name: true } }),
    loadContractMetrics(session.orgId).catch((err) => { console.error("[contracts/metrics]", err); return null; }),
    isFeatureEnabled(session.orgId, "contract_approval_workflow"),
  ]);
  const capped = found.length > MAX_CASES;
  const cases = capped ? found.slice(0, MAX_CASES) : found;
  const scope = capped ? and(org, gte(contractCases.createdAt, cases[cases.length - 1].createdAt)) : org;

  const [documents, validations, analyzed] = await Promise.all([
    db.select({ caseId: contractDocuments.caseId, type: contractDocuments.detectedType })
      .from(contractDocuments).innerJoin(contractCases, eq(contractDocuments.caseId, contractCases.id))
      .where(scope),
    // One row per case, counted the way findingLevel reads a validation in the
    // rest of the app: informative rules are neither a block nor something to review.
    db.select({
      caseId: contractValidations.caseId,
      correct: sql<number>`count(*) filter (where ${contractValidations.ok} = true)::int`,
      finding: sql<number>`count(*) filter (where ${contractValidations.ok} = false and ${contractValidations.severity} = 'block')::int`,
      review: sql<number>`count(*) filter (where (${contractValidations.ok} is null and ${contractValidations.severity} in ('block', 'warn')) or (${contractValidations.ok} = false and ${contractValidations.severity} = 'warn'))::int`,
    })
      .from(contractValidations).innerJoin(contractCases, eq(contractValidations.caseId, contractCases.id))
      .where(scope).groupBy(contractValidations.caseId),
    // When the analysis ended: the first time the case reached a state that
    // waits for a person (as "Hoy" measures it), not its last update.
    db.select({ caseId: statusEvents.entityId, at: sql<Date | string>`min(${statusEvents.changedAt})` })
      .from(statusEvents).innerJoin(contractCases, eq(statusEvents.entityId, contractCases.id))
      .where(and(scope, eq(statusEvents.organizationId, session.orgId), eq(statusEvents.entity, "contract_case"), inArray(statusEvents.toStatus, ["review", "validated", "failed"])))
      .groupBy(statusEvents.entityId),
  ]);
  const analyzedAt = new Map(analyzed.map((row) => [row.caseId, new Date(row.at).toISOString()]));
  // The client uses one stable reference point while the user changes filters.
  const referenceDate = new Date().toISOString();

  return <ContractMetricsClient
    approvalEnabled={approvalEnabled}
    referenceDate={referenceDate}
    cappedAt={capped ? MAX_CASES : null}
    cases={cases.map((item) => ({ ...item, createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString(), analyzedAt: analyzedAt.get(item.id) ?? null }))}
    documents={documents.map((item) => ({ caseId: item.caseId, type: item.type ?? "sin clasificar" }))}
    validations={validations}
    flows={flows}
  >
    {more && <ContractMoreMetrics m={more} />}
  </ContractMetricsClient>;
}
