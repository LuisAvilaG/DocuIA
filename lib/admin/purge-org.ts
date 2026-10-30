// Permanent removal of an organization and everything that belongs to it.
// Runs from the retention cron 30 days after a platform admin marked the org
// as deleted (organizations.deleted_at), never directly from a request.
import { db } from "@/lib/db";
import {
  organizations, orgUsers, authSessions, apiKeys, webhooks, orgFeatures, orgProducts, subscriptions,
  usageDaily, usageEvents, onboardingProgress, notificationPreferences, impersonationSessions, tenantAuditLog,
  nsConnections, subsidiaries, subsidiaryDocumentConfigs, catalogItems, catalogVendors, catalogLocations, itemMappings,
  historyDocuments, exceptionQueue, workflowRuntimeLogs, vendorRules,
  expenseCategories, catalogDepartments, catalogClasses, expenseTaxRules, expenseApprovalChains, expenseReports, expenseItems, expenseDocuments,
  contractDocTypes, contractFieldSchemas, contractValidationRules, contractAiAnalysisTemplates, contractOutputTemplates, contractFlows,
  contractVisualTrainingVariants, contractCases, contractDocuments, contractExtractionLearnings, contractValidations, contractAiAnalysisResults,
  contractObligations, contractArchiveDocuments, contractArchivePages, contractArchiveReferences, contractLargeUploads,
} from "@/db/schema";
import { eq, inArray, lt, and, isNotNull } from "drizzle-orm";
import { deleteFile } from "@/lib/storage/minio";

export const PURGE_AFTER_DAYS = 30;

export interface PurgeSummary { organizationId: string; files: number; tables: number }

/** Counts shown in the delete dialog so the admin knows what goes away. */
export async function orgFootprint(orgId: string) {
  const subs = await db.select({ id: subsidiaries.id }).from(subsidiaries).where(eq(subsidiaries.organizationId, orgId));
  const subIds = subs.map((s) => s.id);
  const caseRows = await db.select({ id: contractCases.id }).from(contractCases).where(eq(contractCases.organizationId, orgId));
  const caseIds = caseRows.map((c) => c.id);
  const [users, docs, cases, docsContract, conns, items, hooks, keys, feats, reports, archive] = await Promise.all([
    db.$count(orgUsers, eq(orgUsers.organizationId, orgId)),
    db.$count(historyDocuments, eq(historyDocuments.organizationId, orgId)),
    Promise.resolve(caseIds.length),
    caseIds.length ? db.$count(contractDocuments, inArray(contractDocuments.caseId, caseIds)) : Promise.resolve(0),
    db.$count(nsConnections, eq(nsConnections.organizationId, orgId)),
    subIds.length ? db.$count(catalogItems, inArray(catalogItems.subsidiaryId, subIds)) : Promise.resolve(0),
    db.$count(webhooks, eq(webhooks.organizationId, orgId)),
    db.$count(apiKeys, eq(apiKeys.organizationId, orgId)),
    db.$count(orgFeatures, eq(orgFeatures.organizationId, orgId)),
    db.$count(expenseReports, eq(expenseReports.organizationId, orgId)),
    db.$count(contractArchiveDocuments, eq(contractArchiveDocuments.organizationId, orgId)),
  ]);
  return { users, documents: docs, cases, contractFiles: docsContract + archive, connections: conns, subsidiaries: subIds.length, catalogItems: items, webhooks: hooks, apiKeys: keys, featureOverrides: feats, expenseReports: reports };
}

async function removeFiles(keys: Array<string | null | undefined>): Promise<number> {
  let n = 0;
  for (const key of keys) {
    if (!key) continue;
    try { await deleteFile(key); n++; } catch { /* best effort */ }
  }
  return n;
}

export async function purgeOrganization(orgId: string): Promise<PurgeSummary> {
  const subs = await db.select({ id: subsidiaries.id }).from(subsidiaries).where(eq(subsidiaries.organizationId, orgId));
  const subIds = subs.map((s) => s.id);
  const reports = await db.select({ id: expenseReports.id }).from(expenseReports).where(eq(expenseReports.organizationId, orgId));
  const reportIds = reports.map((r) => r.id);
  const items = reportIds.length ? await db.select({ id: expenseItems.id }).from(expenseItems).where(inArray(expenseItems.reportId, reportIds)) : [];
  const itemIds = items.map((i) => i.id);
  const cases = await db.select({ id: contractCases.id }).from(contractCases).where(eq(contractCases.organizationId, orgId));
  const caseIds = cases.map((c) => c.id);

  // Storage first (best effort); the rows go in one transaction afterwards.
  const [docFiles, excFiles, contractFiles, archiveFiles, uploadFiles, expenseFiles] = await Promise.all([
    db.select({ k: historyDocuments.storageKey, a: historyDocuments.attachmentKey }).from(historyDocuments).where(eq(historyDocuments.organizationId, orgId)),
    db.select({ k: exceptionQueue.storageKey }).from(exceptionQueue).where(eq(exceptionQueue.organizationId, orgId)),
    caseIds.length ? db.select({ k: contractDocuments.storageKey }).from(contractDocuments).where(inArray(contractDocuments.caseId, caseIds)) : Promise.resolve([] as Array<{ k: string | null }>),
    db.select({ k: contractArchiveDocuments.storageKey }).from(contractArchiveDocuments).where(eq(contractArchiveDocuments.organizationId, orgId)),
    db.select({ k: contractLargeUploads.storageKey }).from(contractLargeUploads).where(eq(contractLargeUploads.organizationId, orgId)),
    itemIds.length ? db.select({ k: expenseDocuments.fileKey }).from(expenseDocuments).where(inArray(expenseDocuments.itemId, itemIds)) : Promise.resolve([] as Array<{ k: string | null }>),
  ]);
  const files = await removeFiles([
    ...docFiles.flatMap((r) => [r.k, r.a]), ...excFiles.map((r) => r.k), ...contractFiles.map((r) => r.k),
    ...archiveFiles.map((r) => r.k), ...uploadFiles.map((r) => r.k), ...expenseFiles.map((r) => r.k),
  ]);

  let tables = 0;
  await db.transaction(async (tx) => {
    const run = async (p: Promise<unknown>) => { await p; tables++; };
    if (itemIds.length) await run(tx.delete(expenseDocuments).where(inArray(expenseDocuments.itemId, itemIds)));
    if (reportIds.length) await run(tx.delete(expenseItems).where(inArray(expenseItems.reportId, reportIds)));
    await run(tx.delete(expenseReports).where(eq(expenseReports.organizationId, orgId)));
    await run(tx.delete(expenseApprovalChains).where(eq(expenseApprovalChains.organizationId, orgId)));
    await run(tx.delete(expenseTaxRules).where(eq(expenseTaxRules.organizationId, orgId)));
    await run(tx.delete(expenseCategories).where(eq(expenseCategories.organizationId, orgId)));
    await run(tx.delete(catalogDepartments).where(eq(catalogDepartments.organizationId, orgId)));
    await run(tx.delete(catalogClasses).where(eq(catalogClasses.organizationId, orgId)));

    if (caseIds.length) {
      await run(tx.delete(contractValidations).where(inArray(contractValidations.caseId, caseIds)));
      await run(tx.delete(contractAiAnalysisResults).where(inArray(contractAiAnalysisResults.caseId, caseIds)));
      await run(tx.delete(contractObligations).where(inArray(contractObligations.caseId, caseIds)));
      await run(tx.delete(contractDocuments).where(inArray(contractDocuments.caseId, caseIds)));
    }
    await run(tx.delete(contractCases).where(eq(contractCases.organizationId, orgId)));
    await run(tx.delete(contractExtractionLearnings).where(eq(contractExtractionLearnings.organizationId, orgId)));
    await run(tx.delete(contractVisualTrainingVariants).where(eq(contractVisualTrainingVariants.organizationId, orgId)));
    await run(tx.delete(contractFlows).where(eq(contractFlows.organizationId, orgId)));
    await run(tx.delete(contractOutputTemplates).where(eq(contractOutputTemplates.organizationId, orgId)));
    await run(tx.delete(contractAiAnalysisTemplates).where(eq(contractAiAnalysisTemplates.organizationId, orgId)));
    await run(tx.delete(contractValidationRules).where(eq(contractValidationRules.organizationId, orgId)));
    await run(tx.delete(contractFieldSchemas).where(eq(contractFieldSchemas.organizationId, orgId)));
    await run(tx.delete(contractDocTypes).where(eq(contractDocTypes.organizationId, orgId)));
    await run(tx.delete(contractArchiveReferences).where(eq(contractArchiveReferences.organizationId, orgId)));
    await run(tx.delete(contractArchivePages).where(eq(contractArchivePages.organizationId, orgId)));
    await run(tx.delete(contractArchiveDocuments).where(eq(contractArchiveDocuments.organizationId, orgId)));
    await run(tx.delete(contractLargeUploads).where(eq(contractLargeUploads.organizationId, orgId)));

    await run(tx.delete(exceptionQueue).where(eq(exceptionQueue.organizationId, orgId)));
    await run(tx.delete(historyDocuments).where(eq(historyDocuments.organizationId, orgId)));
    await run(tx.delete(workflowRuntimeLogs).where(eq(workflowRuntimeLogs.organizationId, orgId)));
    await run(tx.delete(vendorRules).where(eq(vendorRules.organizationId, orgId)));
    if (subIds.length) {
      await run(tx.delete(itemMappings).where(inArray(itemMappings.subsidiaryId, subIds)));
      await run(tx.delete(catalogItems).where(inArray(catalogItems.subsidiaryId, subIds)));
      await run(tx.delete(catalogVendors).where(inArray(catalogVendors.subsidiaryId, subIds)));
      await run(tx.delete(catalogLocations).where(inArray(catalogLocations.subsidiaryId, subIds)));
      await run(tx.delete(subsidiaryDocumentConfigs).where(inArray(subsidiaryDocumentConfigs.subsidiaryId, subIds)));
    }
    await run(tx.delete(subsidiaries).where(eq(subsidiaries.organizationId, orgId)));
    await run(tx.delete(nsConnections).where(eq(nsConnections.organizationId, orgId)));

    await run(tx.delete(webhooks).where(eq(webhooks.organizationId, orgId)));
    await run(tx.delete(apiKeys).where(eq(apiKeys.organizationId, orgId)));
    await run(tx.delete(tenantAuditLog).where(eq(tenantAuditLog.organizationId, orgId)));
    await run(tx.delete(notificationPreferences).where(eq(notificationPreferences.organizationId, orgId)));
    await run(tx.delete(impersonationSessions).where(eq(impersonationSessions.organizationId, orgId)));
    await run(tx.delete(onboardingProgress).where(eq(onboardingProgress.organizationId, orgId)));
    await run(tx.delete(usageEvents).where(eq(usageEvents.organizationId, orgId)));
    await run(tx.delete(usageDaily).where(eq(usageDaily.organizationId, orgId)));
    await run(tx.delete(orgFeatures).where(eq(orgFeatures.organizationId, orgId)));
    await run(tx.delete(orgProducts).where(eq(orgProducts.organizationId, orgId)));
    await run(tx.delete(subscriptions).where(eq(subscriptions.organizationId, orgId)));
    await run(tx.delete(authSessions).where(and(eq(authSessions.organizationId, orgId), eq(authSessions.userType, "org_user"))));
    await run(tx.delete(orgUsers).where(eq(orgUsers.organizationId, orgId)));
    await run(tx.delete(organizations).where(eq(organizations.id, orgId)));
  });

  return { organizationId: orgId, files, tables };
}

/** Orgs whose 30-day recovery window ended. */
export async function purgeExpiredOrganizations(): Promise<PurgeSummary[]> {
  const cutoff = new Date(Date.now() - PURGE_AFTER_DAYS * 86_400_000);
  const expired = await db.select({ id: organizations.id }).from(organizations)
    .where(and(isNotNull(organizations.deletedAt), lt(organizations.deletedAt, cutoff)));
  const out: PurgeSummary[] = [];
  for (const org of expired) {
    try { out.push(await purgeOrganization(org.id)); }
    catch (err) { console.error("[purge-org] failed", { orgId: org.id, err }); }
  }
  return out;
}
