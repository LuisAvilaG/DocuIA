import { getErp } from "@/lib/erp";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, ExternalLink } from "lucide-react";
import { getTenantSession } from "@/lib/auth/jwt";
import { canAccessTenantArea, canApprove } from "@/lib/auth/permissions";
import { requireApAutomation } from "@/lib/products";
import { db } from "@/lib/db";
import { catalogItems, exceptionQueue, historyDocuments, nsConnections, organizations, orgUsers, subsidiaries } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { getFeature, isFeatureEnabled } from "@/lib/features";
import { storedDraft, type NsDraft } from "@/lib/workflow/ns-payload";
import { loadDefaultLocation, loadLocations } from "@/lib/workflow/match";
import { orgTimeZone } from "@/lib/org-time-zone";
import type { ApChecks } from "@/lib/workflow/ap-checks";
import type { LineStatus } from "@/lib/workflow/po-match";
import { sandboxTestSendAvailable, testSendsOf } from "@/lib/workflow/test-send";
import { qaSendsOf } from "@/lib/workflow/qa-send";
import { SandboxTestSend } from "@/components/tenant/sandbox-test-send";
import { btn, Notice, SectionTitle, StatusPill, type StageState } from "@/components/kit";
import type { Tone } from "@/lib/status-vocabulary";
import { friendlyError } from "@/lib/ap/friendly-error";
import { ReviewClient } from "./review-client";
import { DocPreview } from "./doc-preview-lazy";
import { FiscalEmpty, FiscalPanel, InfoRow, PoComparisonCard } from "./ap-panels";
import { InvoiceHead, invoiceStages, parseInvoiceTab, type InvoiceTab } from "./invoice-head";
import { ApproveAction, AutoRefresh, FailedActions, ReceiptActions } from "./invoice-actions";

const READING = new Set(["uploaded", "extracting", "processing", "approved"]);
const DOC_LABEL: Record<string, string> = { invoice: "Factura", purchase_order: "Orden de compra", xml_cfdi: "Factura" };

const LINE_STATUS: Record<LineStatus, { label: string; tone: Tone }> = {
  match:                  { label: "Coincide",          tone: "ok" },
  price_within_tolerance: { label: "Precio en tolerancia", tone: "ok" },
  price_mismatch:         { label: "Precio distinto",   tone: "warn" },
  qty_over:               { label: "Cantidad de más",   tone: "warn" },
  not_received:           { label: "Sin recibir",       tone: "warn" },
  not_in_po:              { label: "No está en la OC",  tone: "warn" },
};

const money = (n: number | null | undefined, currency?: string | null) =>
  n == null ? "—" : `$${n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${currency ? ` ${currency}` : ""}`;
// Formatted on the server, so the client's zone has to be given: the process runs in UTC.
const whenIn = (timeZone: string) => (d: Date) => d.toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone });

/** The draft a reviewer already sent (for approval or to wait for the goods), if the document has one. */
function reviewedDraft(products: unknown): NsDraft | null {
  const saved = products && typeof products === "object" && !Array.isArray(products) ? (products as { approval_draft?: NsDraft }).approval_draft : null;
  return saved && Array.isArray(saved.lines) && saved.lines.length ? saved : null;
}

/**
 * A document that comes back to review opens as the reviewer left it, not as
 * it was first read: the vendor, the items, the lines removed. Each line of the
 * draft keeps the candidates and the position on the page of the line it came from.
 */
async function payloadFromDraft(products: unknown, draft: NsDraft, subsidiaryId: string): Promise<unknown> {
  type ReadLine = { description?: string | null; candidates?: Array<{ internal_id: string }> } & Record<string, unknown>;
  const payload = products as { document: { vendor: Record<string, unknown> & { name?: string | null }; lines: ReadLine[] } & Record<string, unknown> } & Record<string, unknown>;
  const read = payload.document?.lines ?? [];
  const used = new Set<number>();
  const paired = draft.lines.map((d) => {
    const i = read.findIndex((r, k) => !used.has(k) && (r.description ?? "") === d.item_document_name);
    if (i >= 0) used.add(i);
    return { d, from: i >= 0 ? read[i] : null };
  });
  // Items picked from the catalog search are not among the candidates: their names are looked up.
  const unknown = [...new Set(paired.filter(({ d, from }) => !from?.candidates?.some((c) => c.internal_id === d.internal_id)).map(({ d }) => d.internal_id))];
  const names = unknown.length
    ? await db.select({ id: catalogItems.internalId, name: catalogItems.name, itemid: catalogItems.itemid }).from(catalogItems)
        .where(and(eq(catalogItems.subsidiaryId, subsidiaryId), inArray(catalogItems.internalId, unknown)))
    : [];
  const nameOf = new Map(names.map((n) => [n.id, n]));
  const lines = paired.map(({ d, from }, k) => ({
    ...(from ?? { item_code: "", uom: null, candidates: [], match_status: "NOT_FOUND", recommendation_source: "catalog", confidence: 0 }),
    line_no: k + 1,
    description: d.item_document_name,
    quantity: d.quantity,
    rate: d.rate,
    amount: d.amount,
    selected_item_id: d.internal_id,
    selected_unit_id: d.unit,
    ...(nameOf.has(d.internal_id) ? { catalog_name: nameOf.get(d.internal_id)?.name ?? undefined, catalog_itemid: nameOf.get(d.internal_id)?.itemid ?? undefined } : {}),
  }));
  return {
    ...payload,
    document: {
      ...payload.document,
      vendor: { ...payload.document.vendor, selected_internal_id: draft.vendorId, name: draft.vendorName ?? payload.document.vendor.name ?? null },
      lines,
    },
  };
}

interface ViewLine { description: string; itemId: string | null; quantity: number | null; amount: number | null }

/** Líneas del documento ya revisado: del borrador de aprobación, o del formato antiguo. */
function viewLines(products: unknown): ViewLine[] {
  const draft = storedDraft(products);
  if (draft) return draft.lines.map((l) => ({ description: l.item_document_name, itemId: l.internal_id || null, quantity: l.quantity, amount: l.amount }));
  if (Array.isArray(products)) {
    return (products as Array<{ description?: string; quantity?: number; total?: number; nsItemId?: string }>).map((p) => ({
      description: p.description ?? "", itemId: p.nsItemId ?? null, quantity: p.quantity ?? null, amount: p.total ?? null,
    }));
  }
  return [];
}

export default async function InvoiceDetailPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await getTenantSession({ area: "documents" });
  if (!session) redirect("/login");
  await requireApAutomation(session.orgId);

  const { id } = await params;
  const { tab: tabParam } = await searchParams;
  const docId = Number.parseInt(id, 10);
  if (!Number.isSafeInteger(docId)) notFound();

  const doc = await db.query.historyDocuments.findFirst({
    where: and(eq(historyDocuments.id, docId), eq(historyDocuments.organizationId, session.orgId)),
  }).catch(() => null);
  if (!doc) notFound();

  const [sub, storageEnabled, poProcessingEnabled, poMatchingEnabled, approvalWorkflow, sandboxGate, timeZone] = await Promise.all([
    db.query.subsidiaries.findFirst({ where: eq(subsidiaries.id, doc.subsidiaryId), columns: { name: true } }),
    isFeatureEnabled(session.orgId, "document_storage"),
    isFeatureEnabled(session.orgId, "po_processing"),
    isFeatureEnabled(session.orgId, "po_matching"),
    isFeatureEnabled(session.orgId, "approval_workflow"),
    sandboxTestSendAvailable(session.orgId),
    orgTimeZone(session.orgId),
  ]);
  const when = whenIn(timeZone);

  const isPo = doc.documentType === "purchase_order";
  const isCfdi = doc.documentType === "xml_cfdi";
  const canWrite = canAccessTenantArea(session.role, { area: "documents", permission: "write" });
  const isApprover = canApprove(session.role ?? "", "documents");
  const sandboxTest = sandboxGate.ok && !isPo && canWrite;
  const testSends = testSendsOf(doc.products);
  const apChecks = doc.products && typeof doc.products === "object" && !Array.isArray(doc.products)
    ? ((doc.products as { ap_checks?: ApChecks }).ap_checks ?? null)
    : null;
  const fileExt = doc.storageKey ? (doc.storageKey.split(".").pop() ?? "").toLowerCase() : "";
  const showViewer = storageEnabled && Boolean(doc.storageKey) && Boolean(fileExt);

  // ── Por revisar: pantalla de trabajo con edición ──────────────────────────
  if (doc.status === "review") {
    if (!doc.products) notFound();
    const reviewed = reviewedDraft(doc.products);
    const read = reviewed ? await payloadFromDraft(doc.products, reviewed, doc.subsidiaryId) : doc.products;
    // Locations as they are now, not as they were when the invoice was read:
    // a catalog synced afterwards left the reviewer with no location to choose.
    const locations = await loadLocations(doc.subsidiaryId, 500);
    const defaultLocationId = await loadDefaultLocation(doc.subsidiaryId, locations);
    const base = read as { catalogs?: Record<string, unknown> } & Record<string, unknown>;
    const payload = { ...base, catalogs: { ...base.catalogs, locations, default_location_id: defaultLocationId } };
    return (
      <ReviewClient
        docId={doc.id}
        subsidiaryId={doc.subsidiaryId}
        storageKey={showViewer ? doc.storageKey : null}
        fileExt={fileExt}
        poProcessingEnabled={poProcessingEnabled && !isPo}
        poMatchingEnabled={poMatchingEnabled && !isPo}
        apChecks={apChecks}
        statusReason={doc.errorMessage ?? null}
        canApprove={isApprover}
        approvalWorkflow={approvalWorkflow}
        sandboxTest={sandboxTest}
        testSends={testSends}
        initialTab={parseInvoiceTab(tabParam)}
        subsidiaryName={sub?.name ?? null}
        isCfdi={isCfdi}
        canWrite={canWrite}
        initialPoId={reviewed ? reviewed.poId : undefined}
        initialLocationId={reviewed ? reviewed.locationId : defaultLocationId}
        payload={payload as unknown as Parameters<typeof ReviewClient>[0]["payload"]}
      />
    );
  }

  // ── Resto de estados: lectura, con acciones según el estado ───────────────
  const tab: InvoiceTab = tabParam ? parseInvoiceTab(tabParam) : "erp";
  const draft = storedDraft(doc.products);
  const lines = viewLines(doc.products);
  const po = apChecks?.po ?? null;
  const cmp = po?.comparison ?? null;
  const vendor = draft?.vendorName ?? doc.vendor;
  const number = draft?.invoiceNumber ?? doc.numDoc;
  const total = doc.total != null ? Number(doc.total) : null;
  const currency = draft?.currency ?? null;
  const reason = friendlyError(doc.errorMessage);
  // «Orden de compra» sin comparación guardada: qué orden y qué regla aplicaron.
  const chosenPoId = po?.selectedPoId || doc.poInternalId || null;
  const chosenPoNumber = chosenPoId ? po?.openPurchaseOrders.find((order) => order.internal_id === chosenPoId)?.tranid ?? null : null;
  const rule = apChecks?.vendorRule ?? null;

  const [nsRecordUrl, exception, approvers, approvedBy, poConfig] = await Promise.all([
    recordUrl(session.orgId, doc),
    doc.status === "failed"
      ? db.query.exceptionQueue.findFirst({
        where: and(eq(exceptionQueue.organizationId, session.orgId), eq(exceptionQueue.documentId, doc.id), inArray(exceptionQueue.status, ["pending", "in_progress"])),
        columns: { id: true, storageKey: true, subsidiaryId: true, errorCode: true, failureReason: true, retryCount: true },
      })
      : Promise.resolve(undefined),
    doc.status === "pending_approval"
      ? db.select({ name: orgUsers.fullName, email: orgUsers.email }).from(orgUsers)
        .where(and(eq(orgUsers.organizationId, session.orgId), eq(orgUsers.isActive, true), inArray(orgUsers.role, ["admin", "approver"]))).limit(6)
      : Promise.resolve([]),
    doc.approvedBy
      ? db.query.orgUsers.findFirst({ where: and(eq(orgUsers.id, doc.approvedBy), eq(orgUsers.organizationId, session.orgId)), columns: { fullName: true, email: true } })
      : Promise.resolve(undefined),
    getFeature(session.orgId, "po_matching").catch(() => null),
  ]);
  const tolerance = poConfig ? { price: Number(poConfig.config.price_tolerance_pct) || 0, qty: Number(poConfig.config.qty_tolerance_pct) || 0 } : null;

  const erp: { state: StageState; detail: string } =
    READING.has(doc.status) ? { state: "run", detail: doc.status === "processing" ? "Enviando…" : "Leyendo…" }
    : doc.status === "pending_approval" ? { state: "now", detail: "Espera aprobación" }
    : doc.status === "awaiting_receipt" ? { state: "now", detail: "Al llegar la mercancía" }
    : doc.status === "completed" ? { state: "ok", detail: doc.netsuiteDocId ? `${DOC_LABEL[doc.documentType]} ${doc.netsuiteDocId}` : "Modo prueba" }
    : { state: "err", detail: exception?.errorCode ? "El ERP lo rechazó" : "Con error" };

  const stages = invoiceStages({
    lines: { total: lines.length, missing: lines.filter((l) => !l.itemId).length },
    po: { enabled: !isPo && (poMatchingEnabled || poProcessingEnabled || Boolean(po)), selected: po?.selectedPoId ?? doc.poInternalId ?? null, comparison: cmp, outcome: po?.outcome ?? null },
    fiscal: apChecks?.fiscal ?? null,
    isCfdi,
    erp,
  }).map(({ navigable, ...s }) => ({ ...s, href: navigable ? `?tab=${s.key}` : undefined }));

  const statusDetail = doc.status === "pending_approval" ? reason
    : doc.status === "failed" ? (exception?.errorCode ? "el ERP la rechazó" : null)
    : null;

  const actions = (
    <>
      {doc.status === "completed" && nsRecordUrl && <a href={nsRecordUrl} target="_blank" rel="noopener noreferrer" className={btn("secondary")}>Ver en el ERP <ExternalLink /></a>}
      {doc.status === "failed" && exception && <Link href="/exceptions" className={btn("secondary")}>Ver la excepción</Link>}
      {doc.status === "pending_approval" && isApprover && tab !== "erp" && <ApproveAction docId={doc.id} />}
      {doc.status === "awaiting_receipt" && canWrite && tab !== "erp" && <ReceiptActions docId={doc.id} />}
    </>
  );

  const title = [number ? `${DOC_LABEL[doc.documentType] ?? "Documento"} ${number}` : `${DOC_LABEL[doc.documentType] ?? "Documento"} #${doc.id}`, vendor].filter(Boolean).join(" · ");

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {READING.has(doc.status) && <AutoRefresh />}
      <InvoiceHead
        title={title}
        status={doc.status}
        statusDetail={statusDetail}
        meta={[isCfdi ? "CFDI" : isPo ? "Orden de compra" : "Factura en PDF", doc.isQa && "ronda de modo QA", sub?.name && `subsidiaria ${sub.name}`, apChecks?.vendorRule?.ruleId && `regla «${apChecks.vendorRule.ruleLabel.replace(/^(Categoría|Proveedor): /, "")}»`, `llegó ${when(doc.createdAt)}`]}
        actions={actions}
        stages={stages}
        current={tab}
      />

      {tab === "lines" ? (
        <div className={`mt-4.5 grid min-h-0 flex-1 border-t border-border ${showViewer ? "lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]" : ""}`}>
          {showViewer && (
            <div className="hidden min-h-0 flex-col overflow-hidden bg-[#E9E6E0] lg:flex">
              <DocPreview docId={doc.id} activeBbox={undefined} fileExt={fileExt} />
            </div>
          )}
          <div className="min-h-0 overflow-y-auto px-6 py-5.5 md:px-7">
            {/* A failed document says why here too. The reason lived only under
                "Envío al ERP": on this tab a failure showed "Sin líneas" and nothing else. */}
            {doc.status === "failed" && (
              <div role="alert" className="mb-4 rounded-xl border border-[#E9C6C2] bg-tone-err-bg px-4 py-3 text-[13.5px]">
                <b className="font-semibold text-tone-err">{exception?.errorCode ? "El ERP rechazó el documento." : "No se pudo procesar el documento."}</b>{" "}
                {reason ?? "Sin detalle del error."}{" "}
                <Link href="?tab=erp" className="font-semibold text-link hover:underline">Ver cómo seguir</Link>
                {lines.length === 0 && <span className="mt-1 block text-[12.5px] text-muted-foreground">Las líneas no se guardan cuando el documento falla antes de terminar de leerse o de cotejarse.</span>}
              </div>
            )}
            <dl className="grid grid-cols-[130px_minmax(0,1fr)] gap-x-3.5 gap-y-2 text-[13.5px]">
              <dt className="text-muted-foreground">Proveedor</dt><dd>{vendor ?? "—"}</dd>
              {draft?.invoiceDate && <><dt className="text-muted-foreground">Fecha</dt><dd className="tabular-nums">{draft.invoiceDate}</dd></>}
              {draft?.dueDate && <><dt className="text-muted-foreground">Vence</dt><dd className="tabular-nums">{draft.dueDate}</dd></>}
              <dt className="text-muted-foreground">Total</dt><dd className="tabular-nums">{money(total, currency)}</dd>
            </dl>
            <LinesTable lines={lines} cmp={cmp} className="mt-6" />
          </div>
        </div>
      ) : (
        <div className="mt-4.5 min-h-0 flex-1 overflow-y-auto border-t border-border">
          <div className={`flex flex-col gap-5.5 px-6 py-5.5 md:px-8 ${tab === "fiscal" || (tab === "po" && !cmp) ? "" : "max-w-[1100px]"}`}>
            {tab === "po" && (
              cmp ? <PoComparisonCard comparison={cmp} tolerance={tolerance} requireReceipt={po?.requireReceipt ?? false} /> : (
                <section className="mx-auto w-full max-w-[760px]">
                  <SectionTitle title="Orden de compra" aside="Cómo se resolvió en esta factura" />
                  <InfoRow title="Orden de compra">
                    {chosenPoId ? (
                      <>{chosenPoNumber ? `OC ${chosenPoNumber}` : "Se eligió una orden de compra"}<span className="block text-[12.5px] text-muted-foreground">No se guardó la comparación de la factura con la orden.</span></>
                    ) : (
                      <>Sin OC<span className="block text-[12.5px] text-muted-foreground">{doc.status === "completed" ? "Se creó en el ERP como factura independiente." : "Se procesa como factura independiente."}</span></>
                    )}
                  </InfoRow>
                  {rule && (
                    <InfoRow title="Regla del proveedor" end={<Link href="/vendor-rules" className="text-[13px] font-semibold text-link hover:underline">Ver las reglas</Link>}>
                      {rule.ruleId ? rule.ruleLabel : "Predeterminada"}
                      <span className="block text-[12.5px] text-muted-foreground">
                        {rule.poRequirement === "required" ? "Para este proveedor la orden de compra es obligatoria." : rule.poRequirement === "none" ? "Para este proveedor no se usa orden de compra." : "Para este proveedor la orden de compra es opcional."}
                      </span>
                    </InfoRow>
                  )}
                  <InfoRow title="Recepción de almacén">
                    <span className="text-muted-foreground">{chosenPoId ? (po?.requireReceipt ? "La regla pide entrada de almacén antes de enviar." : "La regla no pide entrada de almacén.") : "No aplica: sin orden de compra no hay entrada que esperar."}</span>
                  </InfoRow>
                </section>
              )
            )}

            {tab === "fiscal" && (
              apChecks?.fiscal ? <FiscalPanel fiscal={apChecks.fiscal} /> : <FiscalEmpty isCfdi={isCfdi} />
            )}

            {tab === "erp" && READING.has(doc.status) && (
              <Notice tone="info" title={doc.status === "processing" ? "Enviando al ERP" : "Leyendo el documento"}>Esta página se actualiza sola. Puedes seguir con otros documentos mientras tanto.</Notice>
            )}

            {tab === "erp" && doc.status === "pending_approval" && (
              <>
                {reason && <Notice tone="info" title={reason}>Una persona con permiso de aprobación debe autorizarla antes de crearla en el ERP.</Notice>}
                <LinesTable lines={lines} cmp={cmp} />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-[12.5px] text-muted-foreground">
                    {approvers.length > 0 ? `Pueden aprobar: ${approvers.map((u) => u.name || u.email).join(", ")}.` : "Nadie tiene permiso de aprobación todavía."}
                  </p>
                  {isApprover && <ApproveAction docId={doc.id} />}
                </div>
              </>
            )}

            {tab === "erp" && doc.status === "awaiting_receipt" && (
              <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
                <section>
                  <SectionTitle title="Seguimiento" aside={doc.nextReceiptCheckAt ? `Próxima revisión ${when(doc.nextReceiptCheckAt)}` : undefined} />
                  <ol className="mt-4 flex flex-col gap-4">
                    <Step state="ok" title="Factura leída y validada" detail={[when(doc.createdAt), apChecks?.fiscal?.outcome === "ok" ? "CFDI válido" : null, cmp ? `cuadra con ${cmp.poTranid}` : null].filter(Boolean).join(" · ")} />
                    <Step state="now" title="Esperando la entrada de almacén" detail={reason ?? "La regla exige la entrada de almacén antes de crear la factura."} />
                    <Step state="off" title="Crear la factura en el ERP" detail="Se hace sola en cuanto se registre la recepción." />
                  </ol>
                  {canWrite && <div className="mt-5"><ReceiptActions docId={doc.id} /></div>}
                </section>
                {cmp && (
                  <aside className="rounded-xl border border-border bg-card p-5">
                    <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.05em] text-foreground/75">Recepción en el ERP</span>
                    <table className="w-full text-[13px] tabular-nums">
                      <thead><tr className="border-b border-border text-left text-[11.5px] uppercase tracking-[0.05em] text-muted-foreground">
                        <th scope="col" className="py-2 font-semibold">Línea</th><th scope="col" className="py-2 text-right font-semibold">Factura</th><th scope="col" className="py-2 text-right font-semibold">Recibido</th>
                      </tr></thead>
                      <tbody>
                        {cmp.lines.map((l) => (
                          <tr key={l.index} className="border-b border-line-soft last:border-0">
                            <td className="max-w-[160px] truncate py-2">{l.description}</td>
                            <td className="py-2 text-right">{l.quantity}</td>
                            <td className={`py-2 text-right ${l.missingReceipt > 0 ? "font-semibold text-tone-warn" : ""}`}>{l.poReceivedAvailable ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </aside>
                )}
              </div>
            )}

            {tab === "erp" && doc.status === "completed" && (
              <>
                <div className="flex flex-wrap items-center gap-4 rounded-xl border border-[#BFE3D0] bg-tone-ok-bg px-5 py-4">
                  <CheckCircle2 className="size-5 shrink-0 text-tone-ok" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <b className="block text-base font-semibold">{doc.netsuiteDocId ? `${DOC_LABEL[doc.documentType]} creada en el ERP` : "Procesada en modo prueba"}</b>
                    <p className="text-[13.5px]">
                      {when(doc.updatedAt)} · {approvedBy ? `enviada por ${approvedBy.fullName || approvedBy.email}` : "sin intervención"}
                      {!doc.netsuiteDocId && " · no se creó una transacción real"}
                    </p>
                  </div>
                  {nsRecordUrl && <a href={nsRecordUrl} target="_blank" rel="noopener noreferrer" className={btn("secondary")}>Ver en el ERP <ExternalLink /></a>}
                </div>
                <div className="grid gap-7 lg:grid-cols-2">
                  <section>
                    <SectionTitle title="En el ERP" />
                    <dl className="mt-3 grid grid-cols-[150px_minmax(0,1fr)] gap-x-3.5 gap-y-2 text-[13.5px]">
                      <dt className="text-muted-foreground">ID de la transacción</dt><dd className="tabular-nums">{doc.netsuiteDocId ?? "—"}</dd>
                      <dt className="text-muted-foreground">Proveedor</dt><dd>{vendor ?? "—"}</dd>
                      {!isPo && <><dt className="text-muted-foreground">Orden de compra</dt><dd>{cmp?.poTranid ?? (doc.poInternalId ? `#${doc.poInternalId}` : "Sin OC")}</dd></>}
                      <dt className="text-muted-foreground">Total</dt><dd className="tabular-nums">{money(total, currency)}</dd>
                      <dt className="text-muted-foreground">Líneas</dt><dd>{lines.length}</dd>
                    </dl>
                  </section>
                  {qaSendsOf(doc.qaSends).length > 0 && (
                    <section>
                      <SectionTitle title="Envíos del modo QA" aside={String(qaSendsOf(doc.qaSends).length)} />
                      <ul className="mt-2">
                        {qaSendsOf(doc.qaSends).map((q) => (
                          <li key={q.externalId} className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft py-2.5 text-[13px] last:border-0">
                            <span className="tabular-nums">{when(new Date(q.at))} · <b className="font-semibold">{q.documentNumber}</b>{q.duplicateOf ? <span className="text-muted-foreground"> · duplicado del #{q.duplicateOf}, aceptado por QA</span> : null}</span>
                            {q.recordUrl
                              ? <a href={q.recordUrl} target="_blank" rel="noopener noreferrer" className="text-link hover:underline">ERP {q.internalId}</a>
                              : <StatusPill tone="ok">ERP {q.internalId ?? "—"}</StatusPill>}
                          </li>
                        ))}
                      </ul>
                      <p className="mt-2 text-[12.5px] text-muted-foreground">Durante el modo QA cada envío usa otro número para que el ERP lo cree aunque ya exista.</p>
                    </section>
                  )}
                  {(sandboxTest && draft) || testSends.length > 0 ? (
                    <section>
                      <SectionTitle title="Envíos de prueba a sandbox" aside={testSends.length ? String(testSends.length) : undefined} />
                      <div className="mt-3"><SandboxTestSend docId={doc.id} history={testSends} disabled={!sandboxTest || !draft} /></div>
                    </section>
                  ) : null}
                </div>
              </>
            )}

            {tab === "erp" && doc.status === "failed" && (
              <>
                <div role="alert" className="rounded-xl border border-[#E9C6C2] bg-tone-err-bg px-5 py-4">
                  <b className="block text-base font-semibold text-tone-err">{exception?.errorCode ? "El ERP rechazó el documento" : "No se pudo procesar el documento"}</b>
                  <p className="mt-1 text-[13.5px]">{reason ?? "Sin detalle del error."}</p>
                  {(exception?.errorCode || (doc.errorMessage && doc.errorMessage !== reason)) && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[13px] text-foreground/75">Respuesta completa</summary>
                      <p className="mt-1.5 break-all font-mono text-[12.5px] text-muted-foreground">{[exception?.errorCode, doc.errorMessage].filter(Boolean).join(" · ")}</p>
                    </details>
                  )}
                </div>
                <section>
                  <SectionTitle title="Cómo seguir" />
                  {exception && canWrite
                    ? <FailedActions exceptionId={exception.id} canRetry={Boolean(exception.storageKey && exception.subsidiaryId)} />
                    : <p className="mt-3 text-sm text-muted-foreground">{exception ? "Pide a alguien con permiso de edición que lo reintente." : "Este error ya no tiene una excepción abierta. Si hace falta, súbelo de nuevo."}</p>}
                </section>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Step({ state, title, detail }: { state: "ok" | "now" | "off"; title: string; detail: string }) {
  const mark = state === "ok" ? "bg-tone-ok-bg text-tone-ok" : state === "now" ? "bg-tone-blue text-white" : "border-[1.5px] border-dashed border-[#B9B5AC]";
  return (
    <li className="flex gap-3">
      <span aria-hidden className={`mt-px flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${mark}`}>{state === "ok" ? "✓" : state === "now" ? "●" : ""}</span>
      <span><b className={`block text-[13.5px] font-semibold ${state === "off" ? "text-muted-foreground" : ""}`}>{title}</b><span className="text-[12.5px] text-muted-foreground">{detail}</span></span>
    </li>
  );
}

function LinesTable({ lines, cmp, className }: { lines: ViewLine[]; cmp: { lines: Array<{ index: number; status: LineStatus; priceDiffPct: number | null }> } | null; className?: string }) {
  if (lines.length === 0) return <p className={`text-sm text-muted-foreground ${className ?? ""}`}>Sin líneas.</p>;
  const missing = lines.filter((l) => !l.itemId).length;
  return (
    <section className={className}>
      <SectionTitle title="Líneas" aside={`${lines.length} · ${missing === 0 ? "todas con ítem del ERP" : `${missing} sin ítem`}`} />
      <div className="overflow-x-auto">
        <table className="w-full text-[13.5px] tabular-nums">
          <thead>
            <tr className="border-b border-border">
              {["Descripción", "Cant.", "Total", ...(cmp ? ["Frente a la OC"] : [])].map((h) => (
                <th key={h} scope="col" className={`whitespace-nowrap px-3 py-2.5 text-[11.5px] font-semibold uppercase tracking-[0.05em] text-muted-foreground ${h === "Cant." || h === "Total" ? "text-right" : "text-left"}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const c = cmp?.lines.find((x) => x.index === i);
              const st = c ? LINE_STATUS[c.status] : null;
              return (
                <tr key={i} className={`border-b border-line-soft last:border-0 ${st?.tone === "warn" ? "bg-[#FFFBF2]" : ""}`}>
                  <td className="px-3 py-2.5">{l.description || "—"}{!l.itemId && <span className="ml-2 text-xs text-tone-warn">sin ítem</span>}</td>
                  <td className="px-3 py-2.5 text-right">{l.quantity ?? "—"}</td>
                  <td className="px-3 py-2.5 text-right">{money(l.amount)}</td>
                  {cmp && <td className="px-3 py-2.5">{st ? <StatusPill tone={st.tone}>{st.label}{c?.priceDiffPct != null && c.status !== "match" ? ` ${c.priceDiffPct > 0 ? "+" : ""}${c.priceDiffPct.toLocaleString("es-MX", { maximumFractionDigits: 1 })} %` : ""}</StatusPill> : "—"}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

async function recordUrl(orgId: string, doc: { urlNetsuite: string | null; netsuiteDocId: string | null; documentType: string }): Promise<string | null> {
  if (doc.urlNetsuite) return doc.urlNetsuite;
  if (!doc.netsuiteDocId) return null;
  try {
    // Built by the client's ERP (also when its connection was switched off since).
    return (await getErp(orgId, { includeInactive: true }))?.recordUrl(doc.documentType, doc.netsuiteDocId) ?? null;
  } catch {
    return null;
  }
}
