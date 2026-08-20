import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { getTenantSession } from "@/lib/auth/jwt";
import { isProductActive } from "@/lib/products";
import { isFeatureEnabled } from "@/lib/features";
import { db } from "@/lib/db";
import { contractCases, contractDocuments, contractFlows, contractValidations } from "@/db/schema";
import { ContractMetricsClient } from "./metrics-client";

export default async function ContractMetricsPage() {
  const session = await getTenantSession();
  if (!session) redirect("/login");
  if (!(await isProductActive(session.orgId, "contract_intelligence"))) redirect("/dashboard");
  if (!(await isFeatureEnabled(session.orgId, "contract_metrics"))) redirect("/contracts/dashboard");

  const [cases, documents, validations, flows] = await Promise.all([
    db.query.contractCases.findMany({
      where: eq(contractCases.organizationId, session.orgId),
      columns: { id: true, createdAt: true, updatedAt: true, status: true, flowId: true },
      orderBy: [desc(contractCases.createdAt)],
    }),
    db.select({ caseId: contractDocuments.caseId, type: contractDocuments.detectedType })
      .from(contractDocuments).innerJoin(contractCases, eq(contractDocuments.caseId, contractCases.id))
      .where(eq(contractCases.organizationId, session.orgId)),
    db.select({ caseId: contractValidations.caseId, ok: contractValidations.ok, severity: contractValidations.severity })
      .from(contractValidations).innerJoin(contractCases, eq(contractValidations.caseId, contractCases.id))
      .where(eq(contractCases.organizationId, session.orgId)),
    db.query.contractFlows.findMany({ where: eq(contractFlows.organizationId, session.orgId), columns: { id: true, name: true } }),
  ]);
  // The client uses one stable reference point while the user changes filters.
  const referenceDate = new Date().toISOString();

  return <ContractMetricsClient
    referenceDate={referenceDate}
    cases={cases.map((item) => ({ ...item, createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString() }))}
    documents={documents.map((item) => ({ caseId: item.caseId, type: item.type ?? "sin clasificar" }))}
    validations={validations.map((item) => ({ ...item, severity: item.severity ?? "warn" }))}
    flows={flows}
  />;
}
