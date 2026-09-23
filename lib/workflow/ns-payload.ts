import type { UiPayload } from "./types";

// What a person (or the auto-process decision) approved for posting. The three
// posting paths — auto-process, review and pending approval — all build their
// ERP request from this shape so they cannot drift apart again.
export interface NsDraft {
  vendorId:      string | null;
  vendorName:    string | null;
  invoiceNumber: string | null;
  invoiceDate:   string;
  dueDate:       string | null;
  currency:      string | null;
  locationId:    string | null;
  poId:          string | null;
  lines: Array<{
    internal_id:        string;
    item_document_name: string;
    quantity:           number;
    rate:               number | null;
    amount:             number | null;
    unit:               string | null;
    /** PO line the invoice line bills (from the PO comparison). */
    po_line?:           string | null;
  }>;
}

export interface PoConfig {
  apply_to_po_lines?:               boolean;
  set_unselected_po_lines_to_zero?: boolean;
  allow_additional_lines?:          boolean;
}

// Deterministic per document: the RESTlet deduplicates on it, so a retried or
// double-submitted approval never creates a second bill.
export function nsExternalId(organizationId: string, documentId: number): string {
  return `docuia:${organizationId}:${documentId}`;
}

export function buildNsPayload(draft: NsDraft, ctx: {
  organizationId: string;
  documentId:     number;
  documentType:   string;
  nsSubsidiaryId: string;
  dryRun:         boolean;
  customFormId?:  string;
  poConfig?:      PoConfig;
}): Record<string, unknown> {
  const poConfig = ctx.poConfig ?? {};
  return {
    documentType:                    ctx.documentType,
    dry_run:                         ctx.dryRun,
    ...(ctx.customFormId ? { customform_id: ctx.customFormId } : {}),
    external_id:                     nsExternalId(ctx.organizationId, ctx.documentId),
    subsidiary_internal_id:          ctx.nsSubsidiaryId,
    vendor_id:                       draft.vendorId,
    document_number:                 draft.invoiceNumber,
    date:                            draft.invoiceDate,
    due_date:                        draft.dueDate,
    currency_internal_id:            draft.currency,
    location_internal_id:            draft.locationId,
    po_internal_id:                  draft.poId,
    apply_to_po_lines:               poConfig.apply_to_po_lines ?? true,
    set_unselected_po_lines_to_zero: poConfig.set_unselected_po_lines_to_zero ?? false,
    allow_additional_lines:          poConfig.allow_additional_lines ?? true,
    line_items:                      draft.lines,
  };
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Draft from the extraction payload as matched (auto-process). */
export function draftFromUiPayload(payload: Pick<UiPayload, "document">): NsDraft {
  const d = payload.document;
  return {
    vendorId:      d.vendor.selected_internal_id,
    vendorName:    d.vendor.name,
    invoiceNumber: d.invoice_number,
    invoiceDate:   d.invoice_date,
    dueDate:       d.due_date,
    currency:      d.currency,
    locationId:    null,
    poId:          null,
    lines: d.lines
      .filter((l) => l.selected_item_id)
      .map((l) => ({
        internal_id:        l.selected_item_id!,
        item_document_name: l.description,
        quantity:           l.quantity,
        rate:               l.rate,
        amount:             l.amount,
        unit:               l.selected_unit_id,
      })),
  };
}

/** Auto-process draft plus the PO chosen by the AP checks, with each line tied to its PO line. */
export function draftWithPo(payload: Pick<UiPayload, "document" | "ap_checks">): NsDraft {
  const draft = draftFromUiPayload(payload);
  const po = payload.ap_checks?.po;
  if (!po?.selectedPoId) return draft;
  const poLineByIndex = new Map((po.comparison?.lines ?? []).map((l) => [l.index, l.poLine]));
  // draftFromUiPayload keeps only mapped lines; walk the source lines to keep indexes aligned.
  const mappedIndexes = payload.document.lines.map((l, i) => (l.selected_item_id ? i : -1)).filter((i) => i >= 0);
  return {
    ...draft,
    poId: po.selectedPoId,
    lines: draft.lines.map((line, k) => ({ ...line, po_line: poLineByIndex.get(mappedIndexes[k]) ?? null })),
  };
}

/** Draft from the review form body; returns an error message when invalid. */
export function draftFromReviewBody(body: unknown): NsDraft | string {
  if (typeof body !== "object" || body === null) return "Solicitud inválida";
  const b = body as Record<string, unknown>;
  const vendorId = str(b.vendor_internal_id);
  if (!vendorId) return "Selecciona un proveedor del ERP";
  const rawLines = Array.isArray(b.line_items) ? b.line_items : [];
  const lines = rawLines
    .filter((l): l is Record<string, unknown> => typeof l === "object" && l !== null)
    .map((l) => ({
      internal_id:        str(l.internal_id) ?? "",
      item_document_name: typeof l.item_document_name === "string" ? l.item_document_name : "",
      quantity:           num(l.quantity) ?? 0,
      rate:               num(l.rate),
      amount:             num(l.amount),
      unit:               str(l.unit),
      po_line:            str(l.po_line),
    }))
    .filter((l) => l.internal_id);
  if (!lines.length) return "Se requiere al menos una línea con ítem del ERP";
  return {
    vendorId,
    vendorName:    str(b.vendor_name),
    invoiceNumber: str(b.invoice_number),
    invoiceDate:   str(b.invoice_date) ?? "",
    dueDate:       str(b.due_date),
    currency:      str(b.currency),
    locationId:    str(b.location_internal_id),
    poId:          str(b.po_internal_id),
    lines,
  };
}

/** Draft stored on a document waiting for approval (see approval_draft). */
export function storedDraft(products: unknown): NsDraft | null {
  if (typeof products !== "object" || products === null) return null;
  const p = products as Record<string, unknown>;
  const saved = p.approval_draft;
  if (saved && typeof saved === "object") {
    const draft = saved as NsDraft;
    return Array.isArray(draft.lines) && draft.lines.length ? draft : null;
  }
  // Documents parked by the auto-process decision carry only the UI payload.
  if (p.document && typeof p.document === "object" && Array.isArray((p.document as { lines?: unknown }).lines)) {
    const draft = draftWithPo(p as Pick<UiPayload, "document" | "ap_checks">);
    return draft.lines.length ? draft : null;
  }
  return null;
}
