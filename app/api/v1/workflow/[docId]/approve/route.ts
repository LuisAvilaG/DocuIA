import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { canApprove } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { historyDocuments, subsidiaries } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { processInNetSuite } from "@/lib/workflow/process-ns";
import { isFeatureEnabled, getFeature } from "@/lib/features";
import { upsertItemMappings } from "@/lib/workflow/mappings";
import { resolveCustomFormId } from "@/lib/netsuite/custom-forms";
import { fetchOpenPurchaseOrders } from "@/lib/netsuite/client";
import { getActiveNsConnection, nsCredentials } from "@/lib/netsuite/connection";
import { buildNsPayload, draftFromReviewBody, storedDraft, type NsDraft, type PoConfig } from "@/lib/workflow/ns-payload";
import { deliverWebhooks } from "@/lib/webhooks/deliver";
import { recordPostedAmount } from "@/lib/workflow/pipeline";

type Params = { params: Promise<{ docId: string }> };
type WaitingStatus = "review" | "pending_approval";

const CONFLICT = "Otro usuario ya está procesando o procesó este documento. Recarga la página.";

// The RESTlet re-validates too, but a stale or foreign PO should fail here with
// a clear message instead of as a NetSuite error.
async function validatePurchaseOrder(orgId: string, nsSubsidiaryId: string, draft: NsDraft): Promise<string | null> {
  const connection = await getActiveNsConnection(orgId);
  if (!connection?.catalogScriptId || !connection.catalogDeployId) {
    return "No hay un catálogo de NetSuite configurado para validar la PO seleccionada";
  }
  const open = await fetchOpenPurchaseOrders(nsCredentials(connection), connection.catalogScriptId, connection.catalogDeployId, nsSubsidiaryId, draft.vendorId ?? "");
  if (!open.ok) return `No se pudo validar la PO en NetSuite: ${open.error ?? "error desconocido"}`;
  if (!open.data?.some((po) => po.internal_id === draft.poId)) {
    return "La PO elegida no está abierta o no corresponde al proveedor y subsidiaria seleccionados";
  }
  return null;
}

async function handlePOST(req: NextRequest, { params }: Params) {
  const session = await getTenantSession({ area: "documents", permission: "write" });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { docId } = await params;
  const docIdNum = Number(docId);
  if (!Number.isSafeInteger(docIdNum)) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }

  const doc = await db.query.historyDocuments.findFirst({
    where: and(eq(historyDocuments.id, docIdNum), eq(historyDocuments.organizationId, session.orgId)),
  });
  if (!doc) return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 });
  if (doc.status !== "review" && doc.status !== "pending_approval") {
    return NextResponse.json({ error: `El documento está en estado "${doc.status}", no en revisión` }, { status: 409 });
  }
  const from: WaitingStatus = doc.status;
  const approver = canApprove(session.role, "documents");

  const [formsFeat, autoMappingFeat, poFeature, approvalRequired] = await Promise.all([
    getFeature(session.orgId, "custom_netsuite_forms"),
    getFeature(session.orgId, "auto_mapping"),
    getFeature(session.orgId, "po_processing"),
    isFeatureEnabled(session.orgId, "approval_workflow"),
  ]);

  let draft: NsDraft;
  if (from === "review") {
    const parsed = draftFromReviewBody(await req.json().catch(() => null));
    if (typeof parsed === "string") return NextResponse.json({ error: parsed }, { status: 400 });
    draft = parsed;
  } else {
    if (!approver) return NextResponse.json({ error: "Se requiere permiso de aprobación" }, { status: 403 });
    const saved = storedDraft(doc.products);
    if (!saved) return NextResponse.json({ error: "Sin líneas válidas para enviar" }, { status: 422 });
    draft = saved;
  }

  if (draft.poId && (!poFeature.isEnabled || doc.documentType !== "invoice")) {
    return NextResponse.json({ error: "El procesamiento con PO no está habilitado para este documento" }, { status: 403 });
  }

  const sub = await db.query.subsidiaries.findFirst({
    where: and(eq(subsidiaries.id, doc.subsidiaryId), eq(subsidiaries.organizationId, session.orgId)),
  });
  if (!sub) return NextResponse.json({ error: "Subsidiaria no encontrada" }, { status: 422 });

  if (draft.poId) {
    const poError = await validatePurchaseOrder(session.orgId, sub.nsSubsidiaryId, draft);
    if (poError) return NextResponse.json({ error: poError }, { status: 422 });
  }

  // With the approval workflow on, whoever reviews a low-confidence document
  // still needs someone with approval permission to post it.
  if (from === "review" && approvalRequired && !approver) {
    const base = doc.products && typeof doc.products === "object" ? doc.products as Record<string, unknown> : {};
    const parked = await db.update(historyDocuments)
      .set({
        status:   "pending_approval",
        vendor:   draft.vendorName ?? doc.vendor,
        products: { ...base, approval_draft: draft, approval_requested_by: session.sub } as unknown,
        updatedAt: new Date(),
      })
      .where(and(eq(historyDocuments.id, docIdNum), eq(historyDocuments.status, "review")))
      .returning({ id: historyDocuments.id });
    if (!parked.length) return NextResponse.json({ error: CONFLICT }, { status: 409 });
    return NextResponse.json({ ok: true, status: "pending_approval" });
  }

  // Claim the document atomically: of two concurrent approvals only one moves
  // it to processing, so NetSuite receives a single request.
  const claimed = await db.update(historyDocuments)
    .set({ status: "processing", errorMessage: null, updatedAt: new Date() })
    .where(and(eq(historyDocuments.id, docIdNum), eq(historyDocuments.status, from)))
    .returning({ id: historyDocuments.id });
  if (!claimed.length) return NextResponse.json({ error: CONFLICT }, { status: 409 });

  try {
    const dryRun = await isFeatureEnabled(session.orgId, "netsuite_dry_run");
    const customFormId = formsFeat.isEnabled
      ? resolveCustomFormId(formsFeat.config, doc.subsidiaryId, doc.documentType)
      : "";

    const nsResult = await processInNetSuite(session.orgId, buildNsPayload(draft, {
      organizationId: session.orgId,
      documentId:     docIdNum,
      documentType:   doc.documentType,
      nsSubsidiaryId: sub.nsSubsidiaryId,
      dryRun,
      customFormId:   customFormId || undefined,
      poConfig:       poFeature.config as PoConfig,
    }));

    const vendorName = draft.vendorName ?? doc.vendor ?? null;
    await db.update(historyDocuments).set({
      status:        "completed",
      vendor:        vendorName,
      netsuiteDocId: nsResult.internalId ?? null,
      urlNetsuite:   nsResult.recordUrl ?? null,
      products:      draft.lines.map((l) => ({
        description: l.item_document_name,
        quantity:    l.quantity,
        unitPrice:   l.rate,
        total:       l.amount,
        nsItemId:    l.internal_id,
        unit:        l.unit,
      })) as unknown,
      approvedBy:    session.sub,
      updatedAt:     new Date(),
    }).where(and(eq(historyDocuments.id, docIdNum), eq(historyDocuments.status, "processing")));

    void recordPostedAmount(session.orgId, Number(doc.total ?? 0)).catch(() => {});

    void deliverWebhooks(session.orgId, "document.completed", {
      document: {
        id: docIdNum, status: "completed", documentType: doc.documentType,
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

    return NextResponse.json({ ok: true, status: "completed", netsuiteId: nsResult.internalId, recordUrl: nsResult.recordUrl });
  } catch (err) {
    console.error("[workflow/approve]", err);
    const message = err instanceof Error ? err.message : "Error interno del servidor";
    // Back to the state it was claimed from: a failed approval must not turn a
    // pending-approval document into one any reviewer can post.
    await db.update(historyDocuments)
      .set({ status: from, errorMessage: message, updatedAt: new Date() })
      .where(and(eq(historyDocuments.id, docIdNum), eq(historyDocuments.status, "processing")))
      .catch(() => {});
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export const POST = withApiSecurity(handlePOST);
