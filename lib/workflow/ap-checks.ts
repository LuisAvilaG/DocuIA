// AP checks that run after extraction and item matching: the vendor's rule,
// fiscal validation of the CFDI and the invoice ↔ PO comparison. The result is
// stored on the document (products.ap_checks) so the review screen shows the
// same analysis, and it decides where the document goes next.

import { db } from "@/lib/db";
import { catalogVendors, historyDocuments, subsidiaries, vendorRules } from "@/db/schema";
import { and, eq, ne } from "drizzle-orm";
import { getActiveNsConnection, nsCredentials } from "@/lib/netsuite/connection";
import { fetchOpenPurchaseOrders, fetchPurchaseOrderLines, type NSOpenPurchaseOrder } from "@/lib/netsuite/client";
import { consultSatStatus } from "@/lib/cfdi/sat";
import { evaluateFiscalValidation, parseSatValidationConfig, type FiscalValidation } from "@/lib/cfdi/validation";
import type { CfdiData } from "./cfdi-parser";
import type { UiPayload } from "./types";
import {
  autoSelectedPo, comparePoLines, parsePoMatchConfig, poOutcome, suggestPurchaseOrders,
  type PoComparison, type PoMatchConfig, type PoOutcome, type PoSuggestion,
} from "./po-match";
import { parseVendorRuleConfig, resolveVendorRule, type EffectiveVendorRule } from "./vendor-rules";

export interface PoCheck {
  openPurchaseOrders: NSOpenPurchaseOrder[];
  suggestions:  PoSuggestion[];
  selectedPoId: string | null;
  comparison:   PoComparison | null;
  outcome:      PoOutcome | null;
  requireReceipt: boolean;
  error:        string | null;
}

export interface ApChecks {
  vendorRule: EffectiveVendorRule | null;
  fiscal:     FiscalValidation | null;
  po:         PoCheck | null;
}

export type ApDecision =
  | { next: "continue" }
  | { next: "review"; reason: string }
  | { next: "pending_approval"; reason: string }
  | { next: "awaiting_receipt"; reason: string }
  | { next: "blocked"; reason: string };

export interface ApFeatureFlags {
  isEnabled: (id: string) => boolean;
  getConfig: (id: string) => Record<string, unknown>;
}

/** Tolerances and actions from the po_matching feature, narrowed by the vendor rule. */
export function effectivePoConfig(base: PoMatchConfig, rule: EffectiveVendorRule | null): PoMatchConfig {
  if (!rule) return base;
  return {
    ...base,
    ...(rule.totalTolerancePct !== null ? { totalToleranceType: "percent" as const, totalToleranceValue: rule.totalTolerancePct } : {}),
    ...(rule.priceTolerancePct !== null ? { priceTolerancePct: rule.priceTolerancePct } : {}),
    ...(rule.onMismatch ? { onMismatch: rule.onMismatch } : {}),
  };
}

export function requiresReceipt(flags: ApFeatureFlags, rule: EffectiveVendorRule | null): boolean {
  if (!flags.isEnabled("three_way_match") || !flags.isEnabled("po_matching")) return false;
  const scope = flags.getConfig("three_way_match").scope;
  return scope === "all_po" ? true : Boolean(rule?.requireReceipt);
}

export function invoiceLinesForMatching(payload: Pick<UiPayload, "document">) {
  return payload.document.lines.map((l, index) => ({
    index,
    description: l.description,
    itemId: l.selected_item_id,
    quantity: Number(l.quantity) || 0,
    rate: l.rate,
    amount: l.amount,
  }));
}

/** Loads the PO lines and compares them with the invoice (also used by the review screen and the receipt re-check). */
export async function comparePurchaseOrder(
  organizationId: string,
  poInternalId: string,
  lines: ReturnType<typeof invoiceLinesForMatching>,
  invoiceTotal: number,
  cfg: PoMatchConfig,
  requireReceipt: boolean,
): Promise<{ comparison: PoComparison | null; error: string | null }> {
  const conn = await getActiveNsConnection(organizationId);
  if (!conn?.catalogScriptId || !conn.catalogDeployId) return { comparison: null, error: "No hay script de catálogo configurado para consultar la OC" };
  const res = await fetchPurchaseOrderLines(nsCredentials(conn), conn.catalogScriptId, conn.catalogDeployId, [poInternalId]);
  const po = res.ok ? res.data?.[0] : undefined;
  if (!po) return { comparison: null, error: res.error ?? "No se pudo leer la OC en el ERP" };
  return { comparison: comparePoLines(lines, po, cfg, { requireReceipt, invoiceTotal }), error: null };
}

export async function runApChecks(ctx: {
  organizationId: string;
  subsidiaryId:   string;
  documentId:     number;
  documentType:   "invoice" | "purchase_order" | "xml_cfdi";
  payload:        UiPayload;
  cfdi:           CfdiData | null;
  flags:          ApFeatureFlags;
}): Promise<{ checks: ApChecks; decision: ApDecision }> {
  const checks: ApChecks = { vendorRule: null, fiscal: null, po: null };
  if (ctx.documentType === "purchase_order") return { checks, decision: { next: "continue" } };

  const vendorId = ctx.payload.document.vendor.selected_internal_id;
  const [sub, vendor] = await Promise.all([
    db.query.subsidiaries.findFirst({
      where: and(eq(subsidiaries.id, ctx.subsidiaryId), eq(subsidiaries.organizationId, ctx.organizationId)),
      columns: { name: true, nsSubsidiaryId: true, taxId: true },
    }),
    vendorId
      ? db.query.catalogVendors.findFirst({
          where: and(eq(catalogVendors.subsidiaryId, ctx.subsidiaryId), eq(catalogVendors.internalId, vendorId)),
          columns: { name: true, entityid: true, rfc: true, categoryId: true },
        })
      : Promise.resolve(undefined),
  ]);

  // ── Vendor rule ──────────────────────────────────────────────────────
  if (ctx.flags.isEnabled("vendor_rules")) {
    const rules = await db.query.vendorRules.findMany({ where: eq(vendorRules.organizationId, ctx.organizationId) });
    checks.vendorRule = resolveVendorRule(rules, { internalId: vendorId, categoryId: vendor?.categoryId ?? null }, parseVendorRuleConfig({}));
  }

  // ── Fiscal validation (CFDI XML only) ────────────────────────────────
  if (ctx.flags.isEnabled("sat_cfdi_validation") && ctx.cfdi?.uuid) {
    const cfg = parseSatValidationConfig(ctx.flags.getConfig("sat_cfdi_validation"));
    if (checks.vendorRule && !checks.vendorRule.satRequired) cfg.checkSatStatus = false;
    const [sat, dup] = await Promise.all([
      cfg.checkSatStatus
        ? consultSatStatus({ emisorRfc: ctx.cfdi.emisorRfc, receptorRfc: ctx.cfdi.receptorRfc, total: ctx.cfdi.total, uuid: ctx.cfdi.uuid })
            .catch((err: unknown) => (err instanceof Error ? err : new Error(String(err))))
        : Promise.resolve(null),
      cfg.checkDuplicateUuid
        ? db.query.historyDocuments.findFirst({
            where: and(
              eq(historyDocuments.organizationId, ctx.organizationId),
              eq(historyDocuments.cfdiUuid, ctx.cfdi.uuid.toUpperCase()),
              ne(historyDocuments.id, ctx.documentId),
              ne(historyDocuments.status, "failed"),
            ),
            columns: { id: true, numDoc: true },
          })
        : Promise.resolve(undefined),
    ]);
    checks.fiscal = evaluateFiscalValidation({
      uuid: ctx.cfdi.uuid,
      emisorRfc: ctx.cfdi.emisorRfc,
      receptorRfc: ctx.cfdi.receptorRfc,
      sat,
      subsidiaryTaxId: sub?.taxId ?? null,
      subsidiaryName: sub?.name ?? "la subsidiaria",
      duplicateOf: dup ?? null,
      vendor: vendor ? { name: vendor.name ?? vendor.entityid ?? "Proveedor", rfc: vendor.rfc } : null,
    }, cfg);
  }

  // ── Invoice ↔ PO ─────────────────────────────────────────────────────
  if (ctx.flags.isEnabled("po_matching") && vendorId && sub && checks.vendorRule?.poRequirement !== "none") {
    const cfg = effectivePoConfig(parsePoMatchConfig(ctx.flags.getConfig("po_matching")), checks.vendorRule);
    const requireReceipt = requiresReceipt(ctx.flags, checks.vendorRule);
    const po: PoCheck = { openPurchaseOrders: [], suggestions: [], selectedPoId: null, comparison: null, outcome: null, requireReceipt, error: null };
    const conn = await getActiveNsConnection(ctx.organizationId);
    if (!conn?.catalogScriptId || !conn.catalogDeployId) {
      po.error = "No hay script de catálogo configurado para consultar las OC";
    } else {
      const open = await fetchOpenPurchaseOrders(nsCredentials(conn), conn.catalogScriptId, conn.catalogDeployId, sub.nsSubsidiaryId, vendorId);
      if (!open.ok) {
        po.error = open.error ?? "No se pudieron consultar las OC abiertas";
      } else {
        po.openPurchaseOrders = open.data ?? [];
        const total = Number(ctx.payload.document.totals.total) || 0;
        po.suggestions = suggestPurchaseOrders({ poNumber: ctx.payload.document.purchase_order, total }, po.openPurchaseOrders, cfg);
        const selected = autoSelectedPo(po.suggestions, cfg);
        if (selected) {
          po.selectedPoId = selected.internalId;
          const { comparison, error } = await comparePurchaseOrder(ctx.organizationId, selected.internalId, invoiceLinesForMatching(ctx.payload), total, cfg, requireReceipt);
          po.comparison = comparison;
          po.error = error;
          po.outcome = comparison ? poOutcome(comparison, cfg) : null;
        }
      }
    }
    checks.po = po;
  }

  return { checks, decision: decide(checks) };
}

/** Most severe first: fiscal block, PO block, approval, review, waiting for goods. */
export function decide(checks: ApChecks): ApDecision {
  if (checks.fiscal?.outcome === "blocked") return { next: "blocked", reason: checks.fiscal.reason ?? "Validación fiscal" };
  const po = checks.po;
  if (po?.outcome?.kind === "blocked") return { next: "blocked", reason: po.outcome.reason };
  if (po?.outcome?.kind === "needs_approval") return { next: "pending_approval", reason: po.outcome.reason };
  if (checks.fiscal?.outcome === "review") return { next: "review", reason: checks.fiscal.reason ?? "Revisión fiscal" };
  if (checks.vendorRule?.poRequirement === "required" && po && !po.selectedPoId) {
    return { next: "review", reason: po.error ?? (po.suggestions.length ? "Elige la orden de compra" : "No hay una OC abierta que coincida") };
  }
  if (po?.error) return { next: "review", reason: po.error };
  if (po?.outcome?.kind === "needs_review") return { next: "review", reason: po.outcome.reason };
  if (po?.outcome?.kind === "await_receipt") return { next: "awaiting_receipt", reason: po.outcome.reason };
  return { next: "continue" };
}

export async function loadFeatureFlags(organizationId: string): Promise<ApFeatureFlags> {
  const { getAllFeatures } = await import("@/lib/features");
  const all = await getAllFeatures(organizationId);
  const map = new Map(all.map((f) => [f.id, f]));
  return {
    isEnabled: (id) => map.get(id)?.isEnabled ?? false,
    getConfig: (id) => (map.get(id)?.config ?? {}) as Record<string, unknown>,
  };
}

/**
 * Re-checks a draft against its PO when someone posts it by hand: the reviewer
 * may have changed lines or the PO, and goods may have arrived meanwhile.
 */
export async function gateDraftAgainstPo(opts: {
  organizationId: string;
  draft: { poId: string | null; lines: Array<{ internal_id: string; item_document_name: string; quantity: number; rate: number | null; amount: number | null }> };
  invoiceTotal: number;
  storedChecks: ApChecks | null;
  flags: ApFeatureFlags;
}): Promise<{ comparison: PoComparison | null; outcome: PoOutcome | null; error: string | null }> {
  if (!opts.draft.poId || !opts.flags.isEnabled("po_matching")) return { comparison: null, outcome: null, error: null };
  const rule = opts.storedChecks?.vendorRule ?? null;
  const cfg = effectivePoConfig(parsePoMatchConfig(opts.flags.getConfig("po_matching")), rule);
  const lines = opts.draft.lines.map((l, index) => ({
    index, description: l.item_document_name, itemId: l.internal_id, quantity: l.quantity, rate: l.rate, amount: l.amount,
  }));
  const { comparison, error } = await comparePurchaseOrder(
    opts.organizationId, opts.draft.poId, lines, opts.invoiceTotal, cfg, requiresReceipt(opts.flags, rule),
  );
  return { comparison, outcome: comparison ? poOutcome(comparison, cfg) : null, error };
}
