import { redirect } from "next/navigation";
import { getTenantSession } from "@/lib/auth/jwt";
import { isProductActive } from "@/lib/products";
import { db } from "@/lib/db";
import { contractCases } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { ContractsClient } from "./client";

export default async function ContractsPage() {
  const session = await getTenantSession();
  if (!session) redirect("/login");
  if (!(await isProductActive(session.orgId, "contract_intelligence"))) redirect("/dashboard");

  const cases = await db.query.contractCases.findMany({
    where: eq(contractCases.organizationId, session.orgId),
    columns: { id: true, title: true, status: true, createdAt: true },
    orderBy: [desc(contractCases.createdAt)],
    limit: 200,
  });

  return (
    <ContractsClient
      cases={cases.map((c) => ({ id: c.id, title: c.title, status: c.status, createdAt: c.createdAt.toISOString() }))}
    />
  );
}
