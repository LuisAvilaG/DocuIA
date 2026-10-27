import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { contractArchiveDocuments, contractCases, contractDocuments, contractValidations } from "@/db/schema";
import { calculateContractRevalidation } from "./revalidate";
import { logAudit } from "@/lib/audit/log";

/** Refreshes undecided cases when an older missing reference is resolved. */
export async function syncArchiveCases(sourceArchiveIds: string[]): Promise<void> {
  if (sourceArchiveIds.length === 0) return;
  const archiveDocs = await db.query.contractArchiveDocuments.findMany({ where: inArray(contractArchiveDocuments.id, [...new Set(sourceArchiveIds)]), columns: { id: true, caseDocumentId: true } });
  for (const archiveDoc of archiveDocs) {
    if (!archiveDoc.caseDocumentId) continue;
    const caseDoc = await db.query.contractDocuments.findFirst({ where: eq(contractDocuments.id, archiveDoc.caseDocumentId), columns: { caseId: true } });
    if (!caseDoc) continue;
    const kase = await db.query.contractCases.findFirst({ where: eq(contractCases.id, caseDoc.caseId) });
    if (!kase || !["validated", "review"].includes(kase.status)) continue;
    const recalculation = await calculateContractRevalidation(kase.id);
    let updated = false;
    await db.transaction(async (tx) => {
      const [locked] = await tx.select({ status: contractCases.status, updatedAt: contractCases.updatedAt }).from(contractCases).where(and(eq(contractCases.id, kase.id), eq(contractCases.organizationId, kase.organizationId))).for("update");
      if (!locked || !["validated", "review"].includes(locked.status) || locked.updatedAt.getTime() !== kase.updatedAt.getTime()) return;
      await tx.delete(contractValidations).where(eq(contractValidations.caseId, kase.id));
      if (recalculation.validations.length > 0) await tx.insert(contractValidations).values(recalculation.validations.map((validation) => ({ caseId: kase.id, ruleName: validation.ruleName, severity: validation.severity, subject: validation.subject, status: validation.status, ok: validation.ok, reason: validation.reason, checksJson: validation.checks, citation: validation.citation })));
      await tx.update(contractCases).set({ resultJson: recalculation.resultJson, updatedAt: new Date() }).where(eq(contractCases.id, kase.id));
      updated = true;
    });
    if (updated) await logAudit({ orgId: kase.organizationId, action: "contract.archive_revalidated", resourceType: "contract_case", resourceId: kase.id, metadata: { archiveDocumentId: archiveDoc.id } });
  }
}
