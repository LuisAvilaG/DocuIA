// Posts an already-claimed document (status "processing") to the ERP. Used by
// manual approval and by the goods-receipt re-check, so both build the same
// request, record the same outcome and attach the same files.

import { db } from "@/lib/db";
import { historyDocuments, subsidiaries } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getFeature, isFeatureEnabled } from "@/lib/features";
import { resolveCustomFormId } from "@/lib/netsuite/custom-forms";
import { deliverWebhooks } from "@/lib/webhooks/deliver";
import { processInNetSuite } from "./process-ns";
import { buildNsPayload, type NsDraft, type PoConfig } from "./ns-payload";
import { upsertItemMappings } from "./mappings";
import { recordPostedAmount } from "./pipeline";
import { erpExtras } from "./erp-extras";

type HistoryDocument = typeof historyDocuments.$inferSelect;

export async function postClaimedDocument(opts: {
  doc:        HistoryDocument;
  draft:      NsDraft;
  approvedBy: string | null;
  /** Status to return to when the ERP rejects the request. */
  revertTo:   HistoryDocument["status"];
}): Promise<{ ok: true; netsuiteId: string | null; recordUrl: string | null } | { ok: false; error: string }> {
  const { doc, draft } = opts;
  const orgId = doc.organizationId;
  try {
    const [formsFeat, autoMappingFeat, poFeature, dryRun, sub] = await Promise.all([
      getFeature(orgId, "custom_netsuite_forms"),
      getFeature(orgId, "auto_mapping"),
      getFeature(orgId, "po_processing"),
      isFeatureEnabled(orgId, "netsuite_dry_run"),
      db.query.subsidiaries.findFirst({
        where: and(eq(subsidiaries.id, doc.subsidiaryId), eq(subsidiaries.organizationId, orgId)),
        columns: { nsSubsidiaryId: true },
      }),
    ]);
    if (!sub) throw new Error("Subsidiaria no encontrada");
    const customFormId = formsFeat.isEnabled ? resolveCustomFormId(formsFeat.config, doc.subsidiaryId, doc.documentType) : "";

    const nsResult = await processInNetSuite(orgId, {
      ...buildNsPayload(draft, {
        organizationId: orgId,
        documentId:     doc.id,
        documentType:   doc.documentType,
        nsSubsidiaryId: sub.nsSubsidiaryId,
        dryRun,
        customFormId:   customFormId || undefined,
        poConfig:       poFeature.config as PoConfig,
      }),
      ...(await erpExtras(doc)),
    });

    const vendorName = draft.vendorName ?? doc.vendor ?? null;
    await db.update(historyDocuments).set({
      status:        "completed",
      vendor:        vendorName,
      netsuiteDocId: nsResult.internalId ?? null,
      urlNetsuite:   nsResult.recordUrl ?? null,
      poInternalId:  draft.poId ?? doc.poInternalId,
      products:      draft.lines.map((l) => ({
        description: l.item_document_name,
        quantity:    l.quantity,
        unitPrice:   l.rate,
        total:       l.amount,
        nsItemId:    l.internal_id,
        unit:        l.unit,
      })) as unknown,
      approvedBy:    opts.approvedBy,
      errorMessage:  null,
      nextReceiptCheckAt: null,
      updatedAt:     new Date(),
    }).where(and(eq(historyDocuments.id, doc.id), eq(historyDocuments.status, "processing")));

    void recordPostedAmount(orgId, Number(doc.total ?? 0)).catch(() => {});
    void deliverWebhooks(orgId, "document.completed", {
      document: {
        id: doc.id, status: "completed", documentType: doc.documentType,
        vendor: vendorName, total: doc.total?.toString() ?? null,
        netsuiteDocId: nsResult.internalId, recordUrl: nsResult.recordUrl,
      },
    });
    if (autoMappingFeat.isEnabled) void upsertItemMappings(
      draft.lines.map((l) => ({
        subsidiaryId:       doc.subsidiaryId,
        vendor:             vendorName ?? "",
        vendorItemName:     l.item_document_name,
        netsuiteInternalId: l.internal_id,
        netsuiteItemName:   null,
        netsuiteUnit:       l.unit ?? null,
        autoMap:            false,
      })),
      { mergeSimilarity: Number(autoMappingFeat.config.merge_similarity) },
    ).catch(() => {});

    return { ok: true, netsuiteId: nsResult.internalId, recordUrl: nsResult.recordUrl };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error interno del servidor";
    await db.update(historyDocuments)
      .set({ status: opts.revertTo, errorMessage: message, updatedAt: new Date() })
      .where(and(eq(historyDocuments.id, doc.id), eq(historyDocuments.status, "processing")))
      .catch(() => {});
    return { ok: false, error: message };
  }
}
