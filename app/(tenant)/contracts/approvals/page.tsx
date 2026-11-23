import { findingLevel } from "@/lib/contracts/validate";
import { redirect } from "next/navigation";
import { canApprove } from "@/lib/auth/permissions";
import { getTenantSession } from "@/lib/auth/jwt";
import { isProductActive } from "@/lib/products";
import { getFeature, isFeatureEnabled } from "@/lib/features";
import { db } from "@/lib/db";
import { contractCases, contractDocuments, contractFlows, contractValidations, orgUsers } from "@/db/schema";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { ApprovalsClient, type ApprovalCase } from "./approvals-client";

type Decision = { action?: string; reason?: string | null; byEmail?: string | null; byId?: string | null; at?: string | null; override?: boolean; acknowledged?: number[]; support?: { name?: string } };

export default async function ContractApprovalsPage() {
  const session = await getTenantSession({ area: "contracts" });
  if (!session) redirect("/login");
  if (!(await isProductActive(session.orgId, "contract_intelligence"))) redirect("/dashboard");
  const approvalFeature = await getFeature(session.orgId, "contract_approval_workflow");
  if (!approvalFeature.isEnabled) redirect("/contracts/dashboard");
  if (!canApprove(session.role, "contracts")) redirect("/cases");

  // Por decidir: solo casos con la validación terminada. Decididos: últimos 90 días.
  // eslint-disable-next-line react-hooks/purity
  const since = new Date(Date.now() - 90 * 86_400_000);
  // Two queries: the 90 days and the row limit are for decided cases only. A
  // case waiting for a decision stays in the inbox however old it is.
  const columns = { id: true, title: true, status: true, flowId: true, createdBy: true, createdAt: true, updatedAt: true, resultJson: true } as const;
  const [pendingRows, decidedRows] = await Promise.all([
    db.query.contractCases.findMany({
      where: and(eq(contractCases.organizationId, session.orgId), eq(contractCases.status, "validated")),
      columns, orderBy: [desc(contractCases.updatedAt)], limit: 500,
    }),
    db.query.contractCases.findMany({
      where: and(
        eq(contractCases.organizationId, session.orgId),
        inArray(contractCases.status, ["approved", "generated", "rejected"]),
        gte(contractCases.updatedAt, since),
      ),
      columns, orderBy: [desc(contractCases.updatedAt)], limit: 300,
    }),
  ]);
  const rows = [...pendingRows, ...decidedRows];
  const ids = rows.map((r) => r.id);
  const [flows, documents, validations, users, validationsEnabled] = await Promise.all([
    db.query.contractFlows.findMany({ where: eq(contractFlows.organizationId, session.orgId), columns: { id: true, name: true } }),
    ids.length ? db.query.contractDocuments.findMany({ where: inArray(contractDocuments.caseId, ids), columns: { caseId: true } }) : Promise.resolve([]),
    ids.length ? db.query.contractValidations.findMany({ where: inArray(contractValidations.caseId, ids), columns: { caseId: true, ok: true, severity: true, ruleName: true, subject: true, reason: true } }) : Promise.resolve([]),
    db.query.orgUsers.findMany({ where: eq(orgUsers.organizationId, session.orgId), columns: { id: true, fullName: true, email: true } }),
    isFeatureEnabled(session.orgId, "contract_advanced_validations"),
  ]);

  const flowNames = new Map(flows.map((f) => [f.id, f.name]));
  const userNames = new Map(users.map((u) => [u.id, u.fullName || u.email]));
  const docCount = new Map<string, number>();
  for (const d of documents) docCount.set(d.caseId, (docCount.get(d.caseId) ?? 0) + 1);

  const cases: ApprovalCase[] = rows.flatMap((row) => {
    const result = (row.resultJson ?? {}) as { decision?: Decision | null; outputKey?: string; outputMime?: string };
    const decision = result.decision ?? null;
    const group: ApprovalCase["group"] | null = row.status === "validated" ? "pending"
      : row.status === "rejected" || decision?.action === "reject" ? "rejected"
      : decision?.action === "approve" || row.status === "approved" ? "approved" : null;
    if (!group) return [];
    const checks = validationsEnabled ? validations.filter((v) => v.caseId === row.id) : [];
    const failing = checks.filter((v) => findingLevel(v) !== null);
    return [{
      id: row.id,
      group,
      title: row.title || `Caso ${row.id.slice(0, 8)}`,
      flowName: row.flowId ? flowNames.get(row.flowId) ?? null : null,
      documentCount: docCount.get(row.id) ?? 0,
      createdBy: row.createdBy ? userNames.get(row.createdBy) ?? null : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      blockerCount: failing.filter((v) => findingLevel(v) === "block").length,
      warningCount: failing.filter((v) => findingLevel(v) === "warn").length,
      unverified: checks.filter((v) => v.ok === null).length,
      findings: failing.sort((a, b) => (findingLevel(a) === "block" ? 0 : 1) - (findingLevel(b) === "block" ? 0 : 1)).slice(0, 6)
        .map((v) => ({ severity: findingLevel(v) === "block" ? "block" as const : "warn" as const, title: v.ruleName ?? v.subject, detail: v.reason ?? v.subject })),
      decision: decision ? {
        by: decision.byEmail ?? (decision.byId ? userNames.get(decision.byId) ?? null : null),
        at: decision.at ?? null,
        reason: decision.reason ?? null,
        override: decision.override === true,
        acknowledged: Array.isArray(decision.acknowledged) ? decision.acknowledged.length : 0,
        supportName: decision.support?.name ?? null,
      } : null,
      hasOutput: Boolean(result.outputKey),
      hasWord: result.outputMime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }];
  });

  return <ApprovalsClient cases={cases} allowOverride={approvalFeature.config.allow_override !== false} />;
}
