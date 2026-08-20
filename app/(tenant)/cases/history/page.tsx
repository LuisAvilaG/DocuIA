import { redirect } from "next/navigation";
import { desc, eq, inArray } from "drizzle-orm";
import { getTenantSession } from "@/lib/auth/jwt";
import { isProductActive } from "@/lib/products";
import { isFeatureEnabled } from "@/lib/features";
import { db } from "@/lib/db";
import { contractCases, contractDocuments, contractFlows, orgUsers } from "@/db/schema";
import { CasesHistoryClient, type HistoryCase } from "./history-client";

type Decision = { action?: string; byId?: string | null; byEmail?: string | null; at?: string | null };

function approvedBy(resultJson: unknown, users: Map<string, string>) {
  const result = (resultJson ?? {}) as { decision?: Decision | null; decisionHistory?: Decision[] };
  const decisions = [result.decision, ...(Array.isArray(result.decisionHistory) ? result.decisionHistory : [])]
    .filter((decision): decision is Decision => Boolean(decision));
  const approval = decisions.find((decision) => decision.action === "approve");
  if (!approval) return null;
  return approval.byEmail ?? (approval.byId ? users.get(approval.byId) ?? null : null);
}

export default async function CasesHistoryPage() {
  const session = await getTenantSession();
  if (!session) redirect("/login");
  if (!(await isProductActive(session.orgId, "contract_intelligence"))) redirect("/dashboard");
  if (!(await isFeatureEnabled(session.orgId, "contract_ai_extraction"))) redirect("/contracts/dashboard");

  const [rows, flows, users] = await Promise.all([
    db.query.contractCases.findMany({
      where: eq(contractCases.organizationId, session.orgId),
      columns: { id: true, title: true, status: true, flowId: true, createdBy: true, resultJson: true, createdAt: true, updatedAt: true },
      orderBy: [desc(contractCases.updatedAt)],
    }),
    db.query.contractFlows.findMany({
      where: eq(contractFlows.organizationId, session.orgId),
      columns: { id: true, name: true },
    }),
    db.query.orgUsers.findMany({
      where: eq(orgUsers.organizationId, session.orgId),
      columns: { id: true, email: true, fullName: true },
    }),
  ]);
  const docs = rows.length === 0 ? [] : await db.query.contractDocuments.findMany({
    where: inArray(contractDocuments.caseId, rows.map((row) => row.id)),
    columns: { caseId: true, detectedType: true, originalName: true },
  });
  const flowNames = new Map(flows.map((flow) => [flow.id, flow.name]));
  const userNames = new Map(users.map((user) => [user.id, user.fullName || user.email]));
  const docsByCase = new Map<string, string[]>();
  for (const doc of docs) {
    const types = docsByCase.get(doc.caseId) ?? [];
    const type = doc.detectedType ?? "sin clasificar";
    if (!types.includes(type)) types.push(type);
    docsByCase.set(doc.caseId, types);
  }
  const cases: HistoryCase[] = rows.map((row) => ({
    id: row.id,
    title: row.title || `Caso ${row.id.slice(0, 8)}`,
    status: row.status,
    flowName: row.flowId ? flowNames.get(row.flowId) ?? "Flujo eliminado" : "Sin flujo asignado",
    documentTypes: docsByCase.get(row.id) ?? [],
    creator: row.createdBy ? userNames.get(row.createdBy) ?? null : null,
    approver: approvedBy(row.resultJson, userNames),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));

  return <CasesHistoryClient cases={cases} />;
}
