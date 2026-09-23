// Invoice ↔ purchase-order matching (2-way) and goods-receipt check (3-way).
// Pure functions: the pipeline, the review screen and the receipt re-check all
// call these with data already fetched from the ERP.

import type { NSOpenPurchaseOrder, NSPurchaseOrderDetail } from "@/lib/netsuite/client";

export type ToleranceType = "percent" | "exact" | "amount";

export interface PoMatchConfig {
  suggestByNumber:     boolean;
  suggestByTotal:      boolean;
  autoSelectSingle:    boolean;
  totalToleranceType:  ToleranceType;
  totalToleranceValue: number;
  priceTolerancePct:   number;
  qtyTolerancePct:     number;
  onMismatch:          "approval" | "block" | "warn";
  extraLines:          "warn" | "block";
}

export const DEFAULT_PO_MATCH_CONFIG: PoMatchConfig = {
  suggestByNumber: true, suggestByTotal: true, autoSelectSingle: true,
  totalToleranceType: "percent", totalToleranceValue: 1,
  priceTolerancePct: 2, qtyTolerancePct: 0,
  onMismatch: "approval", extraLines: "warn",
};

const num = (v: unknown, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

/** Reads the po_matching feature config (snake_case, as stored) into typed options. */
export function parsePoMatchConfig(raw: unknown): PoMatchConfig {
  const c = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_PO_MATCH_CONFIG;
  const type = c.total_tolerance_type === "exact" || c.total_tolerance_type === "amount" ? c.total_tolerance_type : "percent";
  const mismatch = c.on_mismatch === "block" || c.on_mismatch === "warn" ? c.on_mismatch : "approval";
  return {
    suggestByNumber:     c.suggest_by_number !== false,
    suggestByTotal:      c.suggest_by_total !== false,
    autoSelectSingle:    c.auto_select_single !== false,
    totalToleranceType:  type,
    totalToleranceValue: num(c.total_tolerance_value, d.totalToleranceValue),
    priceTolerancePct:   num(c.price_tolerance_pct, d.priceTolerancePct),
    qtyTolerancePct:     num(c.qty_tolerance_pct, d.qtyTolerancePct),
    onMismatch:          mismatch,
    extraLines:          c.extra_lines === "block" ? "block" : "warn",
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function normalizePoNumber(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Digits-only tail, so "OC-1043", "PO 1043" and "1043" meet. */
function poDigits(value: string): string {
  return (value.match(/\d+/g) ?? []).join("").replace(/^0+/, "");
}

export function totalWithinTolerance(invoiceTotal: number, poTotal: number, cfg: Pick<PoMatchConfig, "totalToleranceType" | "totalToleranceValue">): boolean {
  const diff = Math.abs(invoiceTotal - poTotal);
  if (cfg.totalToleranceType === "exact") return diff < 0.005;
  if (cfg.totalToleranceType === "amount") return diff <= cfg.totalToleranceValue + 0.005;
  return poTotal > 0 && (diff / poTotal) * 100 <= cfg.totalToleranceValue + 1e-9;
}

export interface PoSuggestion {
  internalId: string;
  tranid:     string;
  date:       string;
  total:      number;
  currency:   string;
  reason:     "number" | "total";
  difference: number;
  differencePct: number;
  withinTolerance: boolean;
}

/**
 * Ranks the vendor's open POs for an invoice: first the one whose number the
 * invoice cites, then those with a similar total. Every open PO remains
 * searchable in the UI; these are only the suggestions.
 */
export function suggestPurchaseOrders(
  invoice: { poNumber: string | null; total: number | null },
  openPOs: NSOpenPurchaseOrder[],
  cfg: PoMatchConfig,
): PoSuggestion[] {
  const total = invoice.total ?? 0;
  const cited = invoice.poNumber ? normalizePoNumber(invoice.poNumber) : "";
  const citedDigits = invoice.poNumber ? poDigits(invoice.poNumber) : "";
  const out: PoSuggestion[] = [];

  for (const po of openPOs) {
    const poTotal = Number(po.total) || 0;
    const difference = round2(total - poTotal);
    const differencePct = poTotal ? round2((difference / poTotal) * 100) : 0;
    const withinTolerance = totalWithinTolerance(total, poTotal, cfg);
    const byNumber = cfg.suggestByNumber && cited !== "" && (
      normalizePoNumber(po.tranid) === cited || (citedDigits !== "" && poDigits(po.tranid) === citedDigits)
    );
    if (byNumber || (cfg.suggestByTotal && total > 0 && withinTolerance)) {
      out.push({
        internalId: po.internal_id, tranid: po.tranid, date: po.date, total: poTotal, currency: po.currency,
        reason: byNumber ? "number" : "total", difference, differencePct, withinTolerance,
      });
    }
  }
  return out.sort((a, b) =>
    (a.reason === "number" ? 0 : 1) - (b.reason === "number" ? 0 : 1) || Math.abs(a.difference) - Math.abs(b.difference));
}

/** The PO to preselect: the cited one, or the only suggestion when configured. */
export function autoSelectedPo(suggestions: PoSuggestion[], cfg: PoMatchConfig): PoSuggestion | null {
  const byNumber = suggestions.filter((s) => s.reason === "number");
  if (byNumber.length === 1) return byNumber[0];
  if (cfg.autoSelectSingle && suggestions.length === 1) return suggestions[0];
  return null;
}

export type LineStatus = "match" | "price_within_tolerance" | "price_mismatch" | "qty_over" | "not_received" | "not_in_po";

export interface InvoiceLineInput {
  index:       number;
  description: string;
  itemId:      string | null;
  quantity:    number;
  rate:        number | null;
  amount:      number | null;
}

export interface LineComparison {
  index:         number;
  description:   string;
  itemId:        string | null;
  quantity:      number;
  rate:          number | null;
  poLine:        string | null;
  poPending:     number | null;
  poReceivedAvailable: number | null;
  poRate:        number | null;
  priceDiffPct:  number | null;
  missingReceipt: number;
  status:        LineStatus;
}

export interface PoComparison {
  poInternalId: string;
  poTranid:     string;
  lines:        LineComparison[];
  invoiceTotal: number;
  poTotal:      number;
  totalDifference: number;
  totalDifferencePct: number;
  totalWithinTolerance: boolean;
  counts: Record<LineStatus, number>;
}

/**
 * Compares invoice lines with the PO lines: pending quantity (ordered − billed),
 * price within tolerance and — for the 3-way match — quantity received and not
 * yet billed. Each invoice line consumes the matching PO lines in order, so two
 * invoice lines of the same item do not both claim the same quantity.
 */
export function comparePoLines(
  invoiceLines: InvoiceLineInput[],
  po: NSPurchaseOrderDetail,
  cfg: Pick<PoMatchConfig, "priceTolerancePct" | "qtyTolerancePct" | "totalToleranceType" | "totalToleranceValue">,
  opts: { requireReceipt: boolean; invoiceTotal: number },
): PoComparison {
  const remaining = po.lines
    .filter((l) => !l.closed)
    .map((l) => ({
      ...l,
      pending: Math.max(0, l.quantity - l.quantity_billed),
      receivedAvailable: Math.max(0, l.quantity_received - l.quantity_billed),
    }));

  const lines: LineComparison[] = invoiceLines.map((inv) => {
    const candidates = inv.itemId ? remaining.filter((l) => l.item_internal_id === inv.itemId) : [];
    const base: LineComparison = {
      index: inv.index, description: inv.description, itemId: inv.itemId, quantity: inv.quantity, rate: inv.rate,
      poLine: null, poPending: null, poReceivedAvailable: null, poRate: null, priceDiffPct: null, missingReceipt: 0,
      status: "not_in_po",
    };
    if (!candidates.length) return base;

    const pending = candidates.reduce((s, l) => s + l.pending, 0);
    const receivedAvailable = candidates.reduce((s, l) => s + l.receivedAvailable, 0);
    const first = candidates[0];
    const rate = inv.rate ?? (inv.amount !== null && inv.quantity ? inv.amount / inv.quantity : null);
    const priceDiffPct = rate !== null && first.rate ? round2(((rate - first.rate) / first.rate) * 100) : null;

    // Consume quantity so a later line of the same item sees what is left.
    let toTake = inv.quantity;
    for (const l of candidates) {
      const take = Math.min(l.pending, toTake);
      l.pending -= take;
      l.receivedAvailable = Math.max(0, l.receivedAvailable - take);
      toTake -= take;
      if (toTake <= 0) break;
    }

    const qtyAllowed = pending * (1 + cfg.qtyTolerancePct / 100) + 1e-9;
    const missingReceipt = opts.requireReceipt ? Math.max(0, round2(inv.quantity - receivedAvailable)) : 0;
    let status: LineStatus = "match";
    if (inv.quantity > qtyAllowed) status = "qty_over";
    else if (priceDiffPct !== null && Math.abs(priceDiffPct) > cfg.priceTolerancePct + 1e-9) status = "price_mismatch";
    else if (missingReceipt > 0) status = "not_received";
    else if (priceDiffPct !== null && Math.abs(priceDiffPct) >= 0.005) status = "price_within_tolerance";

    return {
      ...base, poLine: first.line, poPending: pending, poReceivedAvailable: receivedAvailable,
      poRate: first.rate, priceDiffPct, missingReceipt, status,
    };
  });

  const counts = { match: 0, price_within_tolerance: 0, price_mismatch: 0, qty_over: 0, not_received: 0, not_in_po: 0 } as Record<LineStatus, number>;
  for (const l of lines) counts[l.status]++;
  const totalDifference = round2(opts.invoiceTotal - po.total);
  return {
    poInternalId: po.internal_id,
    poTranid: po.tranid,
    lines,
    invoiceTotal: opts.invoiceTotal,
    poTotal: po.total,
    totalDifference,
    totalDifferencePct: po.total ? round2((totalDifference / po.total) * 100) : 0,
    totalWithinTolerance: totalWithinTolerance(opts.invoiceTotal, po.total, cfg),
    counts,
  };
}

export type PoOutcome =
  | { kind: "ok" }
  | { kind: "await_receipt"; reason: string }
  | { kind: "needs_review"; reason: string }
  | { kind: "needs_approval"; reason: string }
  | { kind: "blocked"; reason: string };

/**
 * What the comparison means for posting. Missing receipts wait (they are not
 * a mismatch); real mismatches follow the configured action.
 */
export function poOutcome(cmp: PoComparison, cfg: Pick<PoMatchConfig, "onMismatch" | "extraLines">): PoOutcome {
  const mismatches: string[] = [];
  if (cmp.counts.qty_over) mismatches.push(`${cmp.counts.qty_over} línea(s) con más cantidad de la pendiente en la OC`);
  if (cmp.counts.price_mismatch) mismatches.push(`${cmp.counts.price_mismatch} línea(s) con precio fuera de tolerancia`);
  if (!cmp.totalWithinTolerance) mismatches.push(`el total difiere ${cmp.totalDifferencePct}% de la OC`);
  const extra = cmp.counts.not_in_po;
  if (extra && cfg.extraLines === "block") mismatches.push(`${extra} línea(s) que no están en la OC`);

  if (mismatches.length) {
    const reason = mismatches.join("; ");
    if (cfg.onMismatch === "block") return { kind: "blocked", reason };
    if (cfg.onMismatch === "approval") return { kind: "needs_approval", reason };
  }
  if (cmp.counts.not_received) {
    const missing = cmp.lines.filter((l) => l.status === "not_received");
    return { kind: "await_receipt", reason: missing.map((l) => `${l.description}: faltan ${l.missingReceipt} por recibir`).join("; ") };
  }
  if (extra) return { kind: "needs_review", reason: `${extra} línea(s) no están en la OC` };
  return { kind: "ok" };
}
