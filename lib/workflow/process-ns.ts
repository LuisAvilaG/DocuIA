import { db } from "@/lib/db";
import { nsConnections, organizations } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { processDocument } from "@/lib/netsuite/client";
import type { NSCredentials } from "@/lib/netsuite/oauth";
import { decryptField } from "@/lib/crypto/encrypt";

function normalize(v: unknown): string {
  return String(v ?? "").trim();
}

function parseDateForNS(value: string): string {
  const raw = normalize(value);
  if (!raw) return "";

  const dot = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (dot) return `${dot[1]}/${dot[2]}/${dot[3]}`;

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;

  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) return raw;

  return raw;
}

function toNum(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function buildRestletBody(payload: Record<string, unknown>): Record<string, unknown> {
  const documentType = normalize(payload.documentType || payload.document_type || "invoice").toLowerCase();
  const isPoType = documentType === "purchase_order";
  const restletDocType = isPoType ? "purchase_order" : "invoice";

  const subsidiaryId = normalize(payload.subsidiary_internal_id || payload.nsSubsidiaryId || "");
  const invoiceNumber = normalize(payload.document_number || payload.invoice_number || "");
  const invoiceDate = parseDateForNS(normalize(payload.date || payload.invoice_date || ""));
  const receiptDate = isPoType ? parseDateForNS(normalize(payload.receipt_date || "")) : "";
  const vendorId = normalize(payload.vendor_id || payload.vendor_internal_id || "");
  const poId = normalize(payload.invoicePO || payload.po_internal_id || "");
  const memo = normalize(payload.memo || "");
  const locationId = normalize(payload.location_internal_id || "");
  const currency = normalize(payload.currency_internal_id || "");

  const lines = Array.isArray(payload.line_items)
    ? (payload.line_items as Record<string, unknown>[])
        .map((line) => ({
          item_internal_id: normalize(line.internal_id || line.item_internal_id || ""),
          quantity: toNum(line.quantity),
          rate: toNum(line.rate),
          amount: toNum(line.amount),
          description: normalize(line.item_document_name || line.description || line.name || ""),
          unit: normalize(line.unit || line.selected_unit_id || ""),
          po_line: normalize(line.po_line || ""),
          location: locationId || null,
        }))
        .filter((l) => Boolean(l.item_internal_id))
    : [];

  const customformId = normalize(payload.customform_id || "");

  return {
    document_type: restletDocType,
    dry_run: Boolean(payload.dry_run ?? false),
    ...(customformId ? { customform: customformId } : {}),
    vendor_internal_id: vendorId || null,
    subsidiary_internal_id: subsidiaryId || null,
    po_internal_id: poId || null,
    invoice_number: invoiceNumber,
    invoice_date: invoiceDate,
    due_date: isPoType ? receiptDate || null : null,
    receipt_date: isPoType ? receiptDate || null : null,
    currency_internal_id: currency || null,
    memo: memo || null,
    location_internal_id: locationId || null,
    lines,
    apply_to_po_lines: Boolean(payload.apply_to_po_lines ?? true),
    set_unselected_po_lines_to_zero: Boolean(payload.set_unselected_po_lines_to_zero ?? false),
    allow_additional_lines: Boolean(payload.allow_additional_lines ?? true),
  };
}

function buildRecordUrl(documentType: string, accountId: string, internalId: string): string {
  if (!accountId || !internalId) return "";
  const normalizedId = accountId.replace(/_/g, "-").toLowerCase();
  if (documentType === "purchase_order") {
    return `https://${normalizedId}.app.netsuite.com/app/accounting/transactions/purchord.nl?id=${internalId}`;
  }
  return `https://${normalizedId}.app.netsuite.com/app/accounting/transactions/vendbill.nl?id=${internalId}`;
}

export async function processInNetSuite(
  organizationId: string,
  payload: Record<string, unknown>
): Promise<{
  ok: boolean;
  internalId: string | null;
  recordUrl: string | null;
  error: string | null;
  nsResponse: Record<string, unknown>;
}> {
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, organizationId),
  });
  if (!org) throw new Error(`Organization ${organizationId} not found`);

  const env = org.activeNsEnvironment as "sandbox" | "production";

  const conn = await db.query.nsConnections.findFirst({
    where: and(
      eq(nsConnections.organizationId, organizationId),
      eq(nsConnections.environment, env)
    ),
  });
  if (!conn) throw new Error(`No NS connection for org ${organizationId} (${env})`);
  if (!conn.processScriptId || !conn.processDeployId) {
    throw new Error("Process script not configured for this organization");
  }

  const creds: NSCredentials = {
    accountId:      conn.accountId,
    consumerKey:    decryptField(conn.consumerKey),
    consumerSecret: decryptField(conn.consumerSecret),
    tokenId:        decryptField(conn.tokenId),
    tokenSecret:    decryptField(conn.tokenSecret),
  };

  const restletBody = buildRestletBody(payload);

  const result = await processDocument(creds, conn.processScriptId, conn.processDeployId, restletBody);

  if (!result.ok) {
    throw new Error(result.error || "NetSuite process restlet returned error");
  }

  const nsData = result.data as Record<string, unknown>;

  // Validate the response has the expected shape of a process script reply.
  // A catalog script ping returns {ok, version, ping} with none of the process fields —
  // catching this here prevents silently marking a document as dry-run completed.
  const hasId         = Boolean(nsData?.vendor_bill_internal_id || nsData?.purchase_order_internal_id || nsData?.internal_id || nsData?.id);
  const isDryRunReply = Boolean(nsData?.would_create);
  const isAlreadyExists = Boolean(nsData?.already_exists);
  const isProcessReply  = hasId || isDryRunReply || isAlreadyExists || "dry_run" in nsData;

  if (!isProcessReply) {
    throw new Error(
      "NetSuite devolvió una respuesta inesperada del script de proceso. " +
      "Verifica que el Process Script ID apunte a docuia-process-v1 y no al catálogo."
    );
  }

  const internalId = normalize(
    nsData?.vendor_bill_internal_id || nsData?.purchase_order_internal_id || nsData?.internal_id || nsData?.id || ""
  ) || null;

  const documentType = normalize(String(restletBody.document_type ?? "invoice"));
  const recordUrl =
    normalize(nsData?.record_url || nsData?.url || "") ||
    (internalId ? buildRecordUrl(documentType, conn.accountId, internalId) : null);

  return {
    ok: true,
    internalId,
    recordUrl: recordUrl || null,
    error: null,
    nsResponse: nsData,
  };
}
