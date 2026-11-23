import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { canApprove } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { historyDocuments, subsidiaries } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getErp } from "@/lib/erp";
import { assignPoLines, draftFromReviewBody, storedDraft, type NsDraft } from "@/lib/workflow/ns-payload";
import { gateDraftAgainstPo, loadFeatureFlags, vendorRuleFor, type ApChecks } from "@/lib/workflow/ap-checks";
import { postClaimedDocument } from "@/lib/workflow/post-draft";
import { reviewCorrections } from "@/lib/workflow/review-corrections";
import { mergeDocMetrics, poAcceptance } from "@/lib/workflow/doc-metrics";

type Params = { params: Promise<{ docId: string }> };
type WaitingStatus = "review" | "pending_approval";

const CONFLICT = "Otro usuario ya está procesando o procesó este documento. Recarga la página.";

// The RESTlet re-validates too, but a stale or foreign PO should fail here with
// a clear message instead of as an ERP error.
async function validatePurchaseOrder(orgId: string, nsSubsidiaryId: string, draft: NsDraft): Promise<string | null> {
  const erp = await getErp(orgId);
  if (!erp?.capabilities.purchaseOrders) return "El ERP conectado no permite validar la OC seleccionada";
  const open = await erp.fetchOpenPurchaseOrders(nsSubsidiaryId, draft.vendorId ?? "");
  if (!open.ok) return `No se pudo validar la OC en el ERP: ${open.error ?? "error desconocido"}`;
  if (!open.data?.some((po) => po.internal_id === draft.poId)) {
    return "La OC elegida no está abierta o no corresponde al proveedor y subsidiaria seleccionados";
  }
  return null;
}

function storedChecks(products: unknown): ApChecks | null {
  const p = products && typeof products === "object" ? products as { ap_checks?: ApChecks } : null;
  return p?.ap_checks ?? null;
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
  const flags = await loadFeatureFlags(session.orgId);

  let draft: NsDraft;
  let requestApproval = false;
  if (from === "review") {
    const body = await req.json().catch(() => null);
    requestApproval = Boolean(body && typeof body === "object" && (body as { request_approval?: unknown }).request_approval === true);
    const parsed = draftFromReviewBody(body);
    if (typeof parsed === "string") return NextResponse.json({ error: parsed }, { status: 400 });
    draft = parsed;
  } else {
    if (!approver) return NextResponse.json({ error: "Se requiere permiso de aprobación" }, { status: 403 });
    const saved = storedDraft(doc.products);
    if (!saved) return NextResponse.json({ error: "Sin líneas válidas para enviar" }, { status: 422 });
    draft = saved;
  }

  const poAllowed = flags.isEnabled("po_processing") || flags.isEnabled("po_matching");
  if (draft.poId && (!poAllowed || doc.documentType === "purchase_order")) {
    return NextResponse.json({ error: "El procesamiento con OC no está habilitado para este documento" }, { status: 403 });
  }

  const sub = await db.query.subsidiaries.findFirst({
    where: and(eq(subsidiaries.id, doc.subsidiaryId), eq(subsidiaries.organizationId, session.orgId)),
  });
  if (!sub) return NextResponse.json({ error: "Subsidiaria no encontrada" }, { status: 422 });

  if (draft.poId) {
    const poError = await validatePurchaseOrder(session.orgId, sub.nsSubsidiaryId, draft);
    if (poError) return NextResponse.json({ error: poError }, { status: 422 });
  }

  // The review screen blocks this too, but an API client or a stale tab must
  // not be able to post a standalone bill for a vendor that requires a PO.
  // The rule is the one of the vendor being posted: the reviewer may have
  // picked a different vendor than the one read at extraction, whose rule is
  // what was stored then (and what the review screen no longer shows).
  const stored = storedChecks(doc.products);
  const vendorRule = flags.isEnabled("vendor_rules")
    ? await vendorRuleFor(session.orgId, doc.subsidiaryId, draft.vendorId, flags)
    : stored?.vendorRule ?? null;
  const previous: ApChecks | null = stored ? { ...stored, vendorRule } : vendorRule ? { vendorRule, fiscal: null, po: null } : null;
  if (!draft.poId && doc.documentType !== "purchase_order" && flags.isEnabled("po_matching") && vendorRule?.poRequirement === "required") {
    return NextResponse.json({ error: "Este proveedor requiere una orden de compra. Elige la OC antes de enviar." }, { status: 422 });
  }

  const base = doc.products && typeof doc.products === "object" ? doc.products as Record<string, unknown> : {};
  // Lo que la persona corrigió respecto de la lectura (métrica «Precisión de lectura»).
  if (from === "review") {
    await mergeDocMetrics(docIdNum, { corrections: { fields: reviewCorrections(base, draft), at: new Date().toISOString(), by: session.sub } }).catch(() => {});
  }
  const park = async (status: "pending_approval" | "awaiting_receipt", reason: string | null, extra: Record<string, unknown> = {}) => {
    const now = new Date();
    const recheckHours = Math.min(48, Math.max(1, Number(flags.getConfig("three_way_match").recheck_hours) || 2));
    const parked = await db.update(historyDocuments)
      .set({
        status,
        vendor:   draft.vendorName ?? doc.vendor,
        products: {
          ...base, ...extra, approval_draft: draft, approval_requested_by: session.sub,
          // Posting when the goods arrive needs no second approval if an approver sent it.
          approval_granted_by: status === "awaiting_receipt" && approver ? session.sub : null,
        } as unknown,
        poInternalId: draft.poId ?? doc.poInternalId,
        errorMessage: reason,
        ...(status === "awaiting_receipt"
          // A reviewer who chooses to wait again starts a new wait: keeping the
          // old date would time it out at the next check.
          ? { awaitingSince: from === "review" ? now : doc.awaitingSince ?? now, nextReceiptCheckAt: new Date(now.getTime() + recheckHours * 3_600_000) }
          : {}),
        updatedAt: now,
      })
      .where(and(eq(historyDocuments.id, docIdNum), eq(historyDocuments.status, from)))
      .returning({ id: historyDocuments.id });
    return parked.length
      ? NextResponse.json({ ok: true, status, reason })
      : NextResponse.json({ error: CONFLICT }, { status: 409 });
  };

  // Check the (possibly edited) draft against its PO before posting it.
  const gate = await gateDraftAgainstPo({
    organizationId: session.orgId,
    draft,
    invoiceTotal: Number(doc.total ?? 0),
    storedChecks: previous,
    flags,
  });
  // What is stored with a parked document is the PO analysis of this draft, so
  // whoever opens it next (the approver) sees the PO that will be billed and
  // not the one the automatic analysis had picked.
  const priorPo = previous?.po ?? { openPurchaseOrders: [], suggestions: [], selectedPoId: null, comparison: null, outcome: null, requireReceipt: false, error: null };
  const gateChecks: Record<string, unknown> = gate.comparison
    ? { ap_checks: { ...(previous ?? { vendorRule, fiscal: null }), po: { ...priorPo, selectedPoId: draft.poId, comparison: gate.comparison, outcome: gate.outcome, error: null } } }
    : !draft.poId && previous?.po
    ? { ap_checks: { ...previous, po: { ...previous.po, selectedPoId: null, comparison: null, outcome: null } } }
    : {};

  // The reviewer explicitly hands the document to an approver.
  if (requestApproval) return park("pending_approval", "Enviada a aprobación por el revisor", gateChecks);

  // Without the PO there is nothing to compare against: posting now would skip
  // tolerances, approval and the receipt check. The automatic path stops too.
  if (gate.error) {
    return NextResponse.json({ error: `No se pudo comparar la factura con la OC: ${gate.error}. Inténtalo de nuevo.` }, { status: 502 });
  }
  // Diferencia con la OC y cómo se acepta (métrica «Diferencias con la OC»).
  if (gate.comparison && gate.outcome && gate.outcome.kind !== "await_receipt") {
    const c = gate.comparison;
    await mergeDocMetrics(docIdNum, { po: {
      poId: c.poInternalId, invoiceTotal: c.invoiceTotal, poTotal: c.poTotal, difference: c.totalDifference, differencePct: c.totalDifferencePct,
      withinTolerance: c.totalWithinTolerance, linesWithinTolerance: c.counts.price_within_tolerance ?? 0, outcome: gate.outcome.kind,
      accepted: poAcceptance(c, gate.outcome.kind), by: session.sub, at: new Date().toISOString(),
    } }).catch(() => {});
  }
  if (gate.outcome?.kind === "await_receipt") return park("awaiting_receipt", gate.outcome.reason, gateChecks);
  if ((gate.outcome?.kind === "needs_approval" || gate.outcome?.kind === "blocked") && !approver) {
    // An approver may send it anyway; everyone else hands it to one.
    return park("pending_approval", gate.outcome.reason, gateChecks);
  }

  // With the approval workflow on, whoever reviews a low-confidence document
  // still needs someone with approval permission to post it.
  if (from === "review" && flags.isEnabled("approval_workflow") && !approver) {
    return park("pending_approval", null, gateChecks);
  }

  // Claim the document atomically: of two concurrent approvals only one moves
  // it to processing, so the ERP receives a single request.
  const claimed = await db.update(historyDocuments)
    .set({ status: "processing", errorMessage: null, updatedAt: new Date() })
    .where(and(eq(historyDocuments.id, docIdNum), eq(historyDocuments.status, from)))
    .returning();
  if (!claimed.length) return NextResponse.json({ error: CONFLICT }, { status: 409 });

  // Back to the state it was claimed from on failure: a failed approval must
  // not turn a pending-approval document into one any reviewer can post.
  // The PO line of each line comes from the comparison just made over these
  // same lines, never from what the browser sent. Only for posting: a parked
  // draft stays as the reviewer left it.
  const toPost = gate.comparison ? { ...draft, lines: assignPoLines(draft.lines, gate.comparison.lines) } : draft;
  const result = await postClaimedDocument({ doc: claimed[0], draft: toPost, approvedBy: session.sub, revertTo: from });
  if (!result.ok) {
    console.error("[workflow/approve]", result.error);
    return NextResponse.json({ error: result.error }, { status: 502 });
  }
  return NextResponse.json({ ok: true, status: "completed", netsuiteId: result.netsuiteId, recordUrl: result.recordUrl });
}

export const POST = withApiSecurity(handlePOST);
