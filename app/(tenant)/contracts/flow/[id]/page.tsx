import { redirect } from "next/navigation";
import { getTenantSession } from "@/lib/auth/jwt";
import { isProductActive } from "@/lib/products";
import { isFeatureEnabled } from "@/lib/features";
import { ContractFlowClient } from "../client";

export default async function ContractFlowEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getTenantSession();
  if (!session) redirect("/login");
  if (!(await isProductActive(session.orgId, "contract_intelligence"))) redirect("/dashboard");
  if (!(await isFeatureEnabled(session.orgId, "contract_flow_builder"))) redirect("/contracts/dashboard");
  if (session.role !== "admin") redirect("/contracts");
  const { id } = await params;
  return <ContractFlowClient flowId={id} />;
}
