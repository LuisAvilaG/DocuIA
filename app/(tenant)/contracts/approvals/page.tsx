import { redirect } from "next/navigation";
import { getTenantSession } from "@/lib/auth/jwt";
import { isProductActive } from "@/lib/products";
import { db } from "@/lib/db";
import { contractCases } from "@/db/schema";
import { and, eq, inArray, desc } from "drizzle-orm";
import { ApprovalsClient, type PendingCase } from "./approvals-client";

export default async function ContractApprovalsPage() {
  const session = await getTenantSession();
  if (!session) redirect("/login");
  if (!(await isProductActive(session.orgId, "contract_intelligence"))) redirect("/dashboard");
  if (session.role !== "admin") redirect("/contracts");

  const rows = await db.query.contractCases.findMany({
    where: and(eq(contractCases.organizationId, session.orgId), inArray(contractCases.status, ["validated", "generated", "review"])),
    columns: { id: true, title: true, status: true, createdAt: true, resultJson: true },
    orderBy: [desc(contractCases.createdAt)],
    limit: 200,
  });

  const cases: PendingCase[] = rows.map((r) => {
    const res = (r.resultJson ?? {}) as { verdict?: "ok" | "warn" | "block"; validations?: number };
    return {
      id: r.id,
      title: r.title || `Caso ${r.id.slice(0, 8)}`,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      verdict: res.verdict ?? null,
      validations: res.validations ?? 0,
    };
  });

  return <ApprovalsClient cases={cases} />;
}
