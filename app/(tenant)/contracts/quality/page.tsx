import { redirect } from "next/navigation";
import { desc, and, eq } from "drizzle-orm";
import { getTenantSession } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { contractExtractionLearnings } from "@/db/schema";
import { isFeatureEnabled } from "@/lib/features";
import { isProductActive } from "@/lib/products";
import { ContractLearningClient } from "./quality-client";

export default async function ContractQualityPage() {
  const session = await getTenantSession();
  if (!session) redirect("/login");
  if (!(await isProductActive(session.orgId, "contract_intelligence"))) redirect("/dashboard");
  if (!(await isFeatureEnabled(session.orgId, "contract_ai_extraction"))) redirect("/contracts/dashboard");
  if (session.role !== "admin") redirect("/contracts");

  const learnings = await db.query.contractExtractionLearnings.findMany({
    where: and(eq(contractExtractionLearnings.organizationId, session.orgId), eq(contractExtractionLearnings.isActive, true)),
    orderBy: [desc(contractExtractionLearnings.createdAt)],
  });
  return <ContractLearningClient learnings={learnings.map((learning) => ({
    id: learning.id,
    documentType: learning.documentType,
    fieldKey: learning.fieldKey,
    originalValue: learning.originalValue,
    correctedValue: learning.correctedValue,
    citation: learning.citation,
    createdAt: learning.createdAt.toISOString(),
  }))} />;
}
