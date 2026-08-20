import { redirect } from "next/navigation";
import { getTenantSession } from "@/lib/auth/jwt";
import { isProductActive } from "@/lib/products";
import { isFeatureEnabled } from "@/lib/features";
import { db } from "@/lib/db";
import { contractCases, contractFlows } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { ContractsClient } from "../contracts/client";

export default async function CasesPage() {
  const session = await getTenantSession();
  if (!session) redirect("/login");
  if (!(await isProductActive(session.orgId, "contract_intelligence"))) redirect("/dashboard");
  if (!(await isFeatureEnabled(session.orgId, "contract_ai_extraction"))) redirect("/contracts/dashboard");

  const [cases, flows] = await Promise.all([
    db.query.contractCases.findMany({
      where: eq(contractCases.organizationId, session.orgId),
      columns: { id: true, title: true, status: true, flowId: true, createdAt: true, updatedAt: true },
      orderBy: [desc(contractCases.updatedAt)],
      limit: 10,
    }),
    db.query.contractFlows.findMany({
      where: eq(contractFlows.organizationId, session.orgId),
      columns: { id: true, name: true },
    }),
  ]);
  const flowNames = new Map(flows.map((flow) => [flow.id, flow.name]));

  return <ContractsClient cases={cases.map((kase) => ({
    id: kase.id,
    title: kase.title,
    status: kase.status,
    createdAt: kase.createdAt.toISOString(),
    updatedAt: kase.updatedAt.toISOString(),
    flowName: kase.flowId ? flowNames.get(kase.flowId) ?? "Flujo eliminado" : "Sin flujo asignado",
  }))} />;
}
