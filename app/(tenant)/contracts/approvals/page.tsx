import { redirect } from "next/navigation";
import { getTenantSession } from "@/lib/auth/jwt";
import { isProductActive } from "@/lib/products";
import { getFeature, isFeatureEnabled } from "@/lib/features";
import { db } from "@/lib/db";
import { contractCases, contractDocuments, contractFlows, contractValidations, orgUsers } from "@/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import { ApprovalsClient, type PendingCase } from "./approvals-client";

export default async function ContractApprovalsPage() {
  const session = await getTenantSession();
  if (!session) redirect("/login");
  if (!(await isProductActive(session.orgId, "contract_intelligence"))) redirect("/dashboard");
  const approvalFeature = await getFeature(session.orgId, "contract_approval_workflow");
  if (!approvalFeature.isEnabled) redirect("/contracts/dashboard");
  if (session.role !== "admin") redirect("/cases");

  // Approval is intentionally a post-validation queue. Generated and review
  // cases cannot be decided here, even if a stale client tries to reach it.
  const rows = await db.query.contractCases.findMany({
    where: and(eq(contractCases.organizationId, session.orgId), eq(contractCases.status, "validated")),
    columns: { id: true, title: true, flowId: true, createdBy: true, createdAt: true, resultJson: true },
    orderBy: [desc(contractCases.updatedAt)],
    limit: 200,
  });
  const ids = rows.map((row) => row.id);
  const [flows, documents, validations, users, validationsEnabled] = await Promise.all([
    db.query.contractFlows.findMany({ where: eq(contractFlows.organizationId, session.orgId), columns: { id: true, name: true } }),
    ids.length ? db.query.contractDocuments.findMany({ where: inArray(contractDocuments.caseId, ids), columns: { caseId: true } }) : Promise.resolve([]),
    ids.length ? db.query.contractValidations.findMany({ where: inArray(contractValidations.caseId, ids), columns: { caseId: true, ok: true, severity: true, ruleName: true, subject: true } }) : Promise.resolve([]),
    db.query.orgUsers.findMany({ where: eq(orgUsers.organizationId, session.orgId), columns: { id: true, fullName: true, email: true } }),
    isFeatureEnabled(session.orgId, "contract_advanced_validations"),
  ]);

  const flowNames = new Map(flows.map((flow) => [flow.id, flow.name]));
  const userNames = new Map(users.map((user) => [user.id, user.fullName || user.email]));
  const documentCounts = new Map<string, number>();
  for (const document of documents) documentCounts.set(document.caseId, (documentCounts.get(document.caseId) ?? 0) + 1);
  const validationsByCase = new Map<string, typeof validations>();
  for (const validation of validations) (validationsByCase.get(validation.caseId) ?? validationsByCase.set(validation.caseId, []).get(validation.caseId)!).push(validation);

  const cases: PendingCase[] = rows.map((row) => {
    const checks = validationsByCase.get(row.id) ?? [];
    const blockers = validationsEnabled ? checks.filter((check) => check.ok === false && check.severity === "block") : [];
    const warnings = validationsEnabled ? checks.filter((check) => check.ok === false && check.severity === "warn") : [];
    const stored = (row.resultJson ?? {}) as { verdict?: "ok" | "warn" | "block" };
    const verdict = validationsEnabled
      ? blockers.length ? "block" : warnings.length ? "warn" : stored.verdict ?? (checks.length ? "ok" : null)
      : null;
    return {
      id: row.id,
      title: row.title || `Caso ${row.id.slice(0, 8)}`,
      createdAt: row.createdAt.toISOString(),
      verdict,
      validations: checks.length,
      blockerCount: blockers.length,
      warningCount: warnings.length,
      blockerSummary: blockers.slice(0, 2).map((check) => check.ruleName || check.subject),
      flowName: row.flowId ? flowNames.get(row.flowId) ?? null : null,
      documentCount: documentCounts.get(row.id) ?? 0,
      createdBy: row.createdBy ? userNames.get(row.createdBy) ?? null : null,
    };
  });

  return <ApprovalsClient cases={cases} allowOverride={approvalFeature.config.allow_override !== false} />;
}
