import { redirect } from "next/navigation";
import { getTenantSession } from "@/lib/auth/jwt";
import { isProductActive } from "@/lib/products";
import { isFeatureEnabled } from "@/lib/features";
import { db } from "@/lib/db";
import { contractCases, contractFlows } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { ContractsClient } from "./client";

export default async function ContractsPage() {
  const session = await getTenantSession();
  if (!session) redirect("/login");
  if (!(await isProductActive(session.orgId, "contract_intelligence"))) redirect("/dashboard");
  if (!(await isFeatureEnabled(session.orgId, "contract_ai_extraction"))) redirect("/contracts/dashboard");

  const [cases, flows] = await Promise.all([
    db.query.contractCases.findMany({
      where: eq(contractCases.organizationId, session.orgId),
      columns: { id: true, title: true, status: true, flowId: true, createdAt: true },
      orderBy: [desc(contractCases.createdAt)],
      limit: 200,
    }),
    db.query.contractFlows.findMany({
      where: eq(contractFlows.organizationId, session.orgId),
      columns: { id: true, name: true },
    }),
  ]);
  const flowNames = new Map(flows.map((flow) => [flow.id, flow.name]));

  return (
    <ContractsClient
      cases={cases.map((c) => ({
        id: c.id,
        title: c.title,
        status: c.status,
        createdAt: c.createdAt.toISOString(),
        flowName: c.flowId ? flowNames.get(c.flowId) ?? "Flujo eliminado" : "Sin flujo asignado",
      }))}
    />
  );
}
