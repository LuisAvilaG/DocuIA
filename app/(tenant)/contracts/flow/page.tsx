import { redirect } from "next/navigation";
import { getTenantSession } from "@/lib/auth/jwt";
import { isProductActive } from "@/lib/products";
import { ContractFlowsListClient } from "./flows-list-client";

export default async function ContractFlowsPage() {
  const session = await getTenantSession();
  if (!session) redirect("/login");
  if (!(await isProductActive(session.orgId, "contract_intelligence"))) redirect("/dashboard");
  if (session.role !== "admin") redirect("/contracts");
  return <ContractFlowsListClient />;
}
