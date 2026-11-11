"use client";

import { useState, useEffect, useRef, useMemo, Fragment } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  CheckCircle2, Loader2, Building2, Search, X,
  Trash2, Plus, ExternalLink, AlertCircle,
} from "lucide-react";
import type { BBox } from "@/lib/workflow/types";
import type { ApChecks } from "@/lib/workflow/ap-checks";
import type { PoComparison, PoOutcome, PoSuggestion } from "@/lib/workflow/po-match";
import type { EffectiveVendorRule } from "@/lib/workflow/vendor-rules";
import { DocPreview } from "./doc-preview-lazy";
import { SelectMenu } from "@/components/ui/select-menu";
import { FiscalPanel, PoComparisonCard, PoPicker } from "./ap-panels";
import type { LineMarker } from "./doc-preview";
import { InvoiceHead, invoiceStages, type InvoiceTab } from "./invoice-head";
import { btn, Notice, type Stage } from "@/components/kit";
import { friendlyError } from "@/lib/ap/friendly-error";
import { SandboxTestSend } from "@/components/tenant/sandbox-test-send";
import type { TestSend } from "@/lib/workflow/test-send";

// ── Types ─────────────────────────────────────────────────────────────────────

interface VendorOption {
  internal_id: string;
  name: string;
  entityid: string;
}

interface ItemOption {
  internal_id: string;
  name: string;
  itemid: string;
  unit: string;
  unit_id: string | null;
  unit_ids: string[];
  unit_names: string[];
  _score: number;
  memory_source?: boolean;
}

interface MatchedLine {
  line_no: number;
  description: string;
  item_code: string;
  quantity: number;
  rate: number | null;
  amount: number | null;
  uom: string | null;
  candidates: ItemOption[];
  selected_item_id: string | null;
  selected_unit_id: string | null;
  match_status: "FOUND_SINGLE" | "FOUND_MULTIPLE" | "NOT_FOUND";
  recommendation_source: "catalog" | "memory";
  confidence: number;
  bbox?: BBox;
}

interface ReviewPayload {
  confidence: { header: number; lines: number; overall: number };
  document: {
    vendor: { name: string | null; options: VendorOption[]; selected_internal_id: string | null };
    invoice_number: string | null;
    invoice_date: string;
    due_date: string | null;
    currency: string;
    purchase_order?: string | null;
    totals: { subtotal: string | null; tax: string; total: string };
    lines: MatchedLine[];
  };
  catalogs: {
    locations: Array<{ internal_id: string; name: string }>;
  };
}

interface ReviewLine extends MatchedLine {
  confirmed_item_id: string | null;
  confirmed_unit_id: string | null;
  catalog_name?: string;
  catalog_itemid?: string;
  catalog_unit_id?: string | null;
  catalog_unit_name?: string | null;
}

interface CatalogSearchItem {
  internalId: string;
  name: string;
  itemid: string;
  unit: string;
  drtUnitId: string | null;
  drtUnitName: string | null;
}

interface PurchaseOrderOption {
  internal_id: string;
  tranid: string;
  date: string;
  total: string;
  currency: string;
  status: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ReviewClient({
  docId,
  subsidiaryId,
  storageKey,
  fileExt,
  poProcessingEnabled = false,
  poMatchingEnabled = false,
  apChecks = null,
  statusReason = null,
  canApprove = false,
  approvalWorkflow = false,
  sandboxTest = false,
  testSends = [],
  payload,
  initialTab = "lines",
  subsidiaryName = null,
  isCfdi = false,
}: {
  docId: number;
  subsidiaryId: string;
  storageKey: string | null;
  fileExt: string;
  poProcessingEnabled?: boolean;
  /** po_matching feature: suggestions, invoice ↔ PO comparison and receipt checks. */
  poMatchingEnabled?: boolean;
  apChecks?: ApChecks | null;
  statusReason?: string | null;
  canApprove?: boolean;
  approvalWorkflow?: boolean;
  /** sandbox_test_send feature while the active ERP environment is sandbox. */
  sandboxTest?: boolean;
  testSends?: TestSend[];
  payload: ReviewPayload;
  initialTab?: InvoiceTab;
  subsidiaryName?: string | null;
  isCfdi?: boolean;
}) {
  const router = useRouter();
  const doc = payload.document;

  const [vendorId, setVendorId]     = useState(doc.vendor.selected_internal_id ?? "");
  const [vendorName, setVendorName] = useState<string>(() => {
    const found = doc.vendor.options.find(v => v.internal_id === (doc.vendor.selected_internal_id ?? ""));
    return found?.name ?? doc.vendor.name ?? "";
  });
  const [locationId, setLocationId] = useState("");
  const initialPo = apChecks?.po ?? null;
  const poEnabled = poMatchingEnabled || poProcessingEnabled;
  const [poId, setPoId] = useState(initialPo?.selectedPoId ?? "");
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderOption[]>(initialPo?.openPurchaseOrders ?? []);
  const [poSuggestions, setPoSuggestions] = useState<PoSuggestion[]>(initialPo?.suggestions ?? []);
  const [vendorRule, setVendorRule] = useState<EffectiveVendorRule | null>(apChecks?.vendorRule ?? null);
  const [requireReceipt, setRequireReceipt] = useState(initialPo?.requireReceipt ?? false);
  const [tolerance, setTolerance] = useState<{ price: number; qty: number; totalType: string; total: number } | null>(null);
  const [purchaseOrdersLoading, setPurchaseOrdersLoading] = useState(false);
  const [purchaseOrdersError, setPurchaseOrdersError] = useState(initialPo?.error ?? "");
  const [comparison, setComparison] = useState<PoComparison | null>(initialPo?.comparison ?? null);
  const [outcome, setOutcome] = useState<PoOutcome | null>(initialPo?.outcome ?? null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitResult, setSubmitResult] = useState<{ netsuiteId: string | null; recordUrl: string | null } | null>(null);

  // Vendor candidates dropdown
  const [vendorCandidatesOpen, setVendorCandidatesOpen] = useState(false);

  // Vendor search dialog
  const [vendorSearchOpen, setVendorSearchOpen]     = useState(false);
  const [vendorQuery, setVendorQuery]               = useState("");
  const [vendorResults, setVendorResults]           = useState<{ internalId: string; name: string; entityid: string }[]>([]);
  const [vendorSearchLoading, setVendorSearchLoading] = useState(false);
  const vendorSearchInputRef = useRef<HTMLInputElement>(null);

  // Initialize lines — pre-select first candidate when available
  const [lines, setLines] = useState<ReviewLine[]>(() =>
    doc.lines.map((l) => {
      const first = l.candidates[0] ?? null;
      return {
        ...l,
        confirmed_item_id: l.selected_item_id ?? first?.internal_id ?? null,
        confirmed_unit_id: l.selected_unit_id ?? first?.unit_id ?? first?.unit_ids?.[0] ?? null,
      };
    })
  );

  // Línea elegida (se resalta en el documento y se edita en el detalle)
  const [activeLine, setActiveLine] = useState<number | null>(null);
  const [tab, setTab] = useState<InvoiceTab>(initialTab);
  function selectTab(t: InvoiceTab) {
    setTab(t);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", t);
    window.history.replaceState(null, "", url);
  }

  // Catalog search dialog
  const [searchIdx, setSearchIdx]         = useState<number | null>(null);
  const [searchQuery, setSearchQuery]     = useState("");
  const [searchResults, setSearchResults] = useState<CatalogSearchItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Prefill when vendor search opens (adjusted during render)
  const [prevVendorSearchOpen, setPrevVendorSearchOpen] = useState(vendorSearchOpen);
  if (vendorSearchOpen !== prevVendorSearchOpen) {
    setPrevVendorSearchOpen(vendorSearchOpen);
    if (vendorSearchOpen) {
      setVendorQuery(doc.vendor.name ?? "");
      setVendorResults([]);
    }
  }

  // Focus when vendor search opens
  useEffect(() => {
    if (vendorSearchOpen) {
      setTimeout(() => vendorSearchInputRef.current?.focus(), 60);
    }
  }, [vendorSearchOpen]);

  // Debounced vendor search — reset/loading flags adjusted during render
  const [prevVendorSearch, setPrevVendorSearch] = useState({ vendorQuery, vendorSearchOpen, subsidiaryId });
  if (
    prevVendorSearch.vendorQuery !== vendorQuery ||
    prevVendorSearch.vendorSearchOpen !== vendorSearchOpen ||
    prevVendorSearch.subsidiaryId !== subsidiaryId
  ) {
    setPrevVendorSearch({ vendorQuery, vendorSearchOpen, subsidiaryId });
    if (!vendorSearchOpen || vendorQuery.length < 1) {
      setVendorResults([]);
      setVendorSearchLoading(false);
    } else {
      setVendorSearchLoading(true);
    }
  }

  useEffect(() => {
    if (!vendorSearchOpen || vendorQuery.length < 1) return;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/v1/catalog/vendors?q=${encodeURIComponent(vendorQuery)}&subsidiaryId=${subsidiaryId}`
        );
        if (res.ok) {
          const data = await res.json();
          setVendorResults(data.vendors ?? []);
        }
      } finally {
        setVendorSearchLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [vendorQuery, vendorSearchOpen, subsidiaryId]);

  function selectVendor(id: string, name: string) {
    setVendorId(id);
    setVendorName(name);
    setPoId("");
    setPurchaseOrders([]);
    setPoSuggestions([]);
    setComparison(null);
    setOutcome(null);
    setPurchaseOrdersError("");
    setVendorSearchOpen(false);
    setVendorCandidatesOpen(false);
  }

  // Open POs of the vendor on screen (and, with po_matching, the suggestions
  // and the vendor's rule). Runs on load too, so the list is always current.
  useEffect(() => {
    if (!poEnabled || !vendorId) return;
    let cancelled = false;
    void Promise.resolve().then(() => {
      setPurchaseOrdersLoading(true);
      setPurchaseOrdersError("");
    });
    const url = poMatchingEnabled
      ? `/api/v1/workflow/${docId}/po-match?vendorId=${encodeURIComponent(vendorId)}`
      : `/api/v1/catalog/open-purchase-orders?subsidiaryId=${encodeURIComponent(subsidiaryId)}&vendorId=${encodeURIComponent(vendorId)}`;
    void fetch(url)
      .then(async res => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "No se pudieron cargar las OC abiertas");
        if (cancelled) return;
        if (poMatchingEnabled) {
          setPurchaseOrders(data.openPurchaseOrders ?? []);
          setPoSuggestions(data.suggestions ?? []);
          setVendorRule(data.vendorRule ?? null);
          setRequireReceipt(Boolean(data.requireReceipt));
          setTolerance(data.tolerance ?? null);
        } else {
          setPurchaseOrders(data.purchaseOrders ?? []);
        }
      })
      .catch(err => {
        if (!cancelled) setPurchaseOrdersError(err instanceof Error ? err.message : "No se pudieron cargar las OC abiertas");
      })
      .finally(() => { if (!cancelled) setPurchaseOrdersLoading(false); });
    return () => { cancelled = true; };
  }, [poEnabled, poMatchingEnabled, docId, subsidiaryId, vendorId]);

  // Prefill when search dialog opens (adjusted during render)
  const [prevSearchIdx, setPrevSearchIdx] = useState(searchIdx);
  if (searchIdx !== prevSearchIdx) {
    setPrevSearchIdx(searchIdx);
    if (searchIdx !== null) {
      const prefill = lines[searchIdx]?.description ?? "";
      setSearchQuery(prefill);
      setSearchResults([]);
    }
  }

  // Focus when search dialog opens
  useEffect(() => {
    if (searchIdx !== null) {
      setTimeout(() => searchInputRef.current?.focus(), 60);
    }
  }, [searchIdx]);

  // Debounced catalog search — reset/loading flags adjusted during render
  const [prevCatalogSearch, setPrevCatalogSearch] = useState({ searchQuery, searchIdx, subsidiaryId });
  if (
    prevCatalogSearch.searchQuery !== searchQuery ||
    prevCatalogSearch.searchIdx !== searchIdx ||
    prevCatalogSearch.subsidiaryId !== subsidiaryId
  ) {
    setPrevCatalogSearch({ searchQuery, searchIdx, subsidiaryId });
    if (searchIdx === null || !searchQuery.trim() || searchQuery.length < 2) {
      setSearchResults([]);
      setSearchLoading(false);
    } else {
      setSearchLoading(true);
    }
  }

  useEffect(() => {
    if (searchIdx === null || !searchQuery.trim() || searchQuery.length < 2) return;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/v1/catalog/items?q=${encodeURIComponent(searchQuery)}&subsidiaryId=${subsidiaryId}`
        );
        if (res.ok) {
          const data = await res.json();
          setSearchResults(data.items ?? []);
        }
      } finally {
        setSearchLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [searchQuery, searchIdx, subsidiaryId]);

  // ── Line helpers ──────────────────────────────────────────────────────────

  function getCandidateItem(line: ReviewLine): ItemOption | null {
    return line.candidates.find(c => c.internal_id === line.confirmed_item_id) ?? null;
  }

  function getDisplayName(line: ReviewLine): string {
    if (!line.confirmed_item_id) return "";
    const c = getCandidateItem(line);
    if (c) return c.name || c.itemid;
    return line.catalog_name || line.confirmed_item_id;
  }

  function getDisplayCode(line: ReviewLine): string | null {
    if (!line.confirmed_item_id) return null;
    const c = getCandidateItem(line);
    if (c) return c.itemid && c.itemid !== c.name ? c.itemid : null;
    return line.catalog_itemid || null;
  }

  function selectFromCandidate(idx: number, itemId: string) {
    setLines(prev => prev.map((l, i) => {
      if (i !== idx) return l;
      const item = l.candidates.find(c => c.internal_id === itemId) ?? null;
      return {
        ...l,
        confirmed_item_id: itemId || null,
        confirmed_unit_id: item?.unit_id ?? item?.unit_ids?.[0] ?? null,
        catalog_name: undefined, catalog_itemid: undefined,
        catalog_unit_id: undefined, catalog_unit_name: undefined,
      };
    }));
  }

  function selectFromSearch(idx: number, item: CatalogSearchItem) {
    setLines(prev => prev.map((l, i) => {
      if (i !== idx) return l;
      return {
        ...l,
        confirmed_item_id: item.internalId,
        confirmed_unit_id: item.drtUnitId ?? null,
        catalog_name: item.name, catalog_itemid: item.itemid,
        catalog_unit_id: item.drtUnitId ?? null, catalog_unit_name: item.drtUnitName ?? null,
      };
    }));
    setSearchIdx(null);
  }

  function setLineUnit(idx: number, unitId: string) {
    setLines(prev => prev.map((l, i) => i === idx ? { ...l, confirmed_unit_id: unitId || null } : l));
  }

  function deleteLine(idx: number) {
    setLines(prev => {
      const next = prev.filter((_, i) => i !== idx);
      return next.map((l, i) => ({ ...l, line_no: i + 1 }));
    });
    setActiveLine(prev => {
      if (prev === null) return null;
      if (prev === idx) return null;
      return prev > idx ? prev - 1 : prev;
    });
  }

  function addLine() {
    setLines(prev => [
      ...prev,
      {
        line_no: prev.length + 1,
        description: "",
        item_code: "",
        quantity: 1,
        rate: null,
        amount: null,
        uom: null,
        candidates: [],
        selected_item_id: null,
        selected_unit_id: null,
        match_status: "NOT_FOUND" as const,
        recommendation_source: "catalog" as const,
        confidence: 0,
        confirmed_item_id: null,
        confirmed_unit_id: null,
      },
    ]);
  }

  // ── Invoice ↔ PO comparison ───────────────────────────────────────────────

  const validLines = useMemo(() => lines.filter(l => l.confirmed_item_id), [lines]);
  const lineItems = useMemo(() => validLines.map(l => ({
    internal_id:        l.confirmed_item_id,
    item_document_name: l.description,
    quantity:           l.quantity,
    rate:               l.rate,
    amount:             l.amount,
    unit:               l.confirmed_unit_id,
  })), [validLines]);
  const compareKey = poMatchingEnabled && poId ? JSON.stringify([poId, vendorId, lineItems]) : "";
  const lastCompareKey = useRef(initialPo?.comparison && initialPo.selectedPoId === poId ? JSON.stringify([poId, vendorId, lineItems]) : "");

  useEffect(() => {
    if (!compareKey || compareKey === lastCompareKey.current) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setCompareLoading(true);
      setCompareError("");
      try {
        const res = await fetch(`/api/v1/workflow/${docId}/po-match`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ po_internal_id: poId, vendor_internal_id: vendorId, line_items: lineItems }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) { setCompareError(data.error ?? "No se pudo comparar con la OC"); setComparison(null); setOutcome(null); return; }
        lastCompareKey.current = compareKey;
        setComparison(data.comparison ?? null);
        setOutcome(data.outcome ?? null);
      } catch {
        if (!cancelled) setCompareError("No se pudo conectar con el servidor");
      } finally {
        if (!cancelled) setCompareLoading(false);
      }
    }, 500);
    return () => { cancelled = true; clearTimeout(t); };
  }, [compareKey, docId, poId, vendorId, lineItems]);

  function choosePo(id: string) {
    setPoId(id);
    if (!id) { setComparison(null); setOutcome(null); setCompareError(""); }
  }

  // ── Submit ────────────────────────────────────────────────────────────────

  // The draft as the reviewer sees it: what approval posts and what a sandbox
  // test send uses, so both go to the ERP with the same lines.
  function reviewBody(): Record<string, unknown> {
    const current = comparison && comparison.poInternalId === poId ? comparison : null;
    return {
      vendor_internal_id:   vendorId,
      vendor_name:          vendorName || null,
      invoice_number:       doc.invoice_number,
      invoice_date:         doc.invoice_date,
      due_date:             doc.due_date,
      currency:             doc.currency,
      location_internal_id: locationId || null,
      po_internal_id:       poId || null,
      line_items: lineItems.map((l, i) => ({
        ...l,
        po_line: current?.lines.find(c => c.index === i)?.poLine ?? null,
      })),
    };
  }

  async function handleApprove(opts: { requestApproval?: boolean } = {}) {
    setSubmitError("");
    if (!vendorId) { setSubmitError("Selecciona un proveedor del ERP antes de aprobar."); return; }
    if (!validLines.length) { setSubmitError("Asigna al menos un ítem del ERP para poder aprobar."); return; }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/v1/workflow/${docId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...reviewBody(), request_approval: opts.requestApproval === true }),
      });
      const data = await res.json();
      if (!res.ok) { setSubmitError(data.error ?? "Error al procesar en el ERP"); return; }
      // Parked for an approver or for the goods receipt: the page shows the new state.
      if (data.status === "pending_approval" || data.status === "awaiting_receipt") { router.refresh(); return; }
      setSubmitResult({ netsuiteId: data.netsuiteId ?? null, recordUrl: data.recordUrl ?? null });
    } catch {
      setSubmitError("No se pudo conectar al servidor");
    } finally {
      setSubmitting(false);
    }
  }

  const assignedCount = lines.filter(l => l.confirmed_item_id).length;
  const missingCount  = lines.length - assignedCount;
  const overallPct    = Math.round(payload.confidence.overall * 100);

  // ── Action bar: what happens when the reviewer sends the document ─────────
  type ActionButton = { label: string; run: () => void; disabled?: boolean };
  const liveOutcome = poMatchingEnabled && poId && comparison?.poInternalId === poId ? outcome : null;
  const parksForApproval = approvalWorkflow && !canApprove;
  const sendLabel = parksForApproval ? "Enviar a aprobación" : "Aprobar y enviar al ERP";
  const ruleName = vendorRule?.ruleId ? vendorRule.ruleLabel.replace(/^(Categoría|Proveedor): /, "") : null;
  const action: { tone: "none" | "warn" | "err"; message: React.ReactNode; primary: ActionButton; secondary?: ActionButton } = (() => {
    const send = () => { void handleApprove(); };
    const toApprover = () => { void handleApprove({ requestApproval: true }); };
    if (poMatchingEnabled && vendorRule?.poRequirement === "required" && !poId) {
      return { tone: "err", message: "Este proveedor exige orden de compra: elige una para continuar.", primary: { label: sendLabel, run: send, disabled: true } };
    }
    if (poMatchingEnabled && poId && compareLoading) {
      return { tone: "none", message: "Comparando con la OC…", primary: { label: sendLabel, run: send, disabled: true } };
    }
    switch (liveOutcome?.kind) {
      case "await_receipt":
        return {
          tone: "err",
          message: <>No se puede enviar aún: {liveOutcome.reason}.{ruleName && <> La regla <strong>{ruleName}</strong> exige entrada de almacén.</>} Al esperar, se revisa automáticamente hasta que llegue.</>,
          primary: { label: "Esperar recepción", run: send },
          secondary: { label: "Enviar a aprobación", run: toApprover },
        };
      case "needs_approval":
      case "blocked":
        return canApprove
          ? { tone: "warn", message: <>Fuera de tolerancia: {liveOutcome.reason}. Como aprobador puedes enviarla de todos modos.</>, primary: { label: "Aprobar y enviar al ERP", run: send } }
          : { tone: "warn", message: <>Fuera de tolerancia: {liveOutcome.reason}. Un aprobador debe autorizarla.</>, primary: { label: "Enviar a aprobación", run: send } };
      case "needs_review":
        return { tone: "warn", message: <>{liveOutcome.reason}. Revisa las líneas antes de enviar.</>, primary: { label: sendLabel, run: send } };
      default:
        return {
          tone: "none",
          message: liveOutcome?.kind === "ok"
            ? <span className="text-success font-medium">La factura cuadra con la OC.</span>
            : parksForApproval ? "Al enviarla, un aprobador la revisará antes de crearla en el ERP." : "Verifica proveedor, OC y líneas antes de enviar.",
          primary: { label: missingCount > 0 ? `${sendLabel} (${missingCount} sin ítem)` : sendLabel, run: send },
        };
    }
  })();

  // ── Vista ─────────────────────────────────────────────────────────────────
  const firstMissing = lines.findIndex((l) => !l.confirmed_item_id);
  const selIdx = activeLine !== null && activeLine >= 0 && activeLine < lines.length ? activeLine : Math.max(0, firstMissing);
  const sel = lines[selIdx] ?? null;
  const selCandidate = sel ? getCandidateItem(sel) : null;
  const selOthers = sel ? sel.candidates.filter((c) => c.internal_id !== sel.confirmed_item_id) : [];
  const otherVendors = doc.vendor.options.filter((v) => v.internal_id !== vendorId);
  const activeBbox = sel?.bbox;
  const markers: LineMarker[] = lines.flatMap((l, i) => (l.bbox ? [{ n: l.line_no, bbox: l.bbox, warn: !l.confirmed_item_id, active: i === selIdx }] : []));
  const unitName = (l: ReviewLine) => {
    const c = getCandidateItem(l);
    if (c) {
      const k = c.unit_ids.indexOf(l.confirmed_unit_id ?? "");
      return (k >= 0 ? c.unit_names[k] : c.unit_names[0]) || c.unit || null;
    }
    return l.catalog_unit_name ?? null;
  };
  // Cuadre: la suma de las líneas contra el subtotal (o el total si no hay subtotal).
  const balance = (() => {
    const amounts = lines.map((l) => l.amount).filter((x): x is number => x !== null);
    if (amounts.length === 0) return null;
    const sum = amounts.reduce((x, y) => x + y, 0);
    const expected = Number(doc.totals.subtotal ?? doc.totals.total);
    if (!Number.isFinite(expected) || expected === 0) return null;
    return { sum, expected, ok: Math.abs(sum - expected) < 0.5 };
  })();
  const stages: Stage[] = invoiceStages({
    lines: { total: lines.length, missing: missingCount },
    vendorMissing: !vendorId,
    po: {
      enabled: poEnabled,
      required: poMatchingEnabled && vendorRule?.poRequirement === "required",
      selected: poId || null,
      comparison: comparison?.poInternalId === poId ? comparison : null,
      outcome: liveOutcome,
      suggestions: poSuggestions.length,
      loading: compareLoading,
    },
    fiscal: apChecks?.fiscal ?? null,
    isCfdi,
    erp: { state: "off", detail: parksForApproval ? "Al pedir aprobación" : "Al aprobar" },
  }).map(({ navigable, ...st }) => ({ ...st, onSelect: navigable ? () => selectTab(st.key) : undefined }));

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Result modal ─────────────────────────────────────────────────── */}
      {submitResult !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "oklch(0.18 0.015 258 / 0.55)" }}
        >
          <div
            className="bg-card border border-border rounded-2xl w-full max-w-md overflow-hidden"
            style={{ boxShadow: "0 24px 64px oklch(0.18 0.015 258 / 0.2), 0 4px 16px oklch(0.18 0.015 258 / 0.1)" }}
          >
            {/* Header */}
            <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
              <div className="w-8 h-8 rounded-full bg-emerald-500/15 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-foreground">Documento enviado al ERP</p>
                <p className="text-xs text-muted-foreground mt-0.5">La transacción fue creada exitosamente</p>
              </div>
            </div>

            {/* Details */}
            <div className="px-5 py-4 space-y-3">
              {submitResult.netsuiteId && (
                <div className="flex items-center justify-between gap-3 py-2 border-b border-border/60">
                  <span className="text-xs text-muted-foreground">ID en el ERP</span>
                  <span className="text-xs font-mono font-semibold text-foreground bg-secondary px-2 py-0.5 rounded">
                    {submitResult.netsuiteId}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between gap-3 py-2 border-b border-border/60">
                <span className="text-xs text-muted-foreground">Documento</span>
                <span className="text-xs font-medium text-foreground">#{doc.invoice_number || docId}</span>
              </div>
              <div className="flex items-center justify-between gap-3 py-2">
                <span className="text-xs text-muted-foreground">Proveedor</span>
                <span className="text-xs font-medium text-foreground truncate max-w-[180px]">{vendorName || vendorId}</span>
              </div>
            </div>

            {/* Actions */}
            <div className="px-5 py-4 border-t border-border flex items-center gap-2.5">
              {submitResult.recordUrl && (
                <a
                  href={submitResult.recordUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-border text-xs font-medium text-foreground hover:bg-secondary transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Ver en el ERP
                </a>
              )}
              <button
                onClick={() => router.push(`/history/${docId}`)}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors"
              >
                Ver documento
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Vendor search dialog ─────────────────────────────────────────── */}
      {vendorSearchOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "oklch(0.18 0.015 258 / 0.4)" }}
          onClick={() => setVendorSearchOpen(false)}
        >
          <div
            className="bg-card border border-border rounded-2xl w-full max-w-lg flex flex-col overflow-hidden"
            style={{ boxShadow: "0 20px 60px oklch(0.18 0.015 258 / 0.15), 0 4px 16px oklch(0.18 0.015 258 / 0.08)", maxHeight: "65vh" }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 px-4 py-3.5 border-b border-border">
              <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />
              <input
                ref={vendorSearchInputRef}
                type="text"
                value={vendorQuery}
                onChange={e => setVendorQuery(e.target.value)}
                placeholder="Nombre o ID del proveedor..."
                className="flex-1 text-sm bg-transparent text-foreground placeholder:text-muted-foreground/50 outline-none"
              />
              {vendorSearchLoading
                ? <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin shrink-0" />
                : vendorQuery && (
                  <button onClick={() => setVendorQuery("")} className="text-muted-foreground hover:text-foreground transition-colors shrink-0">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )
              }
              <button
                onClick={() => setVendorSearchOpen(false)}
                className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {vendorQuery.length < 1 ? (
                <div className="py-10 text-center">
                  <Building2 className="w-6 h-6 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">Escribe para buscar proveedores</p>
                </div>
              ) : vendorSearchLoading ? (
                <div className="py-10 flex items-center justify-center gap-2 text-muted-foreground text-sm">
                  <Loader2 className="w-4 h-4 animate-spin" /> Buscando...
                </div>
              ) : vendorResults.length === 0 ? (
                <div className="py-10 text-center">
                  <p className="text-sm text-muted-foreground">Sin resultados para &quot;{vendorQuery}&quot;</p>
                </div>
              ) : (
                <div className="py-1">
                  {vendorResults.map(v => (
                    <button
                      key={v.internalId}
                      onClick={() => selectVendor(v.internalId, v.name || v.entityid)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-secondary/60 transition-colors text-left group"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{v.name || v.entityid}</p>
                        {v.entityid && v.entityid !== v.name && (
                          <span className="text-[11px] font-mono text-muted-foreground">{v.entityid}</span>
                        )}
                      </div>
                      <CheckCircle2 className="w-4 h-4 text-primary opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="px-4 py-2 border-t border-border bg-secondary/30">
              <p className="text-[11px] text-muted-foreground">
                {vendorResults.length > 0
                  ? `${vendorResults.length} resultado${vendorResults.length !== 1 ? "s" : ""} · Clic para seleccionar`
                  : "Busca por nombre o código de proveedor"}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Backdrop for vendor candidates */}
      {vendorCandidatesOpen && (
        <div className="fixed inset-0 z-20" onClick={() => setVendorCandidatesOpen(false)} />
      )}

      {/* ── Catalog search dialog ────────────────────────────────────────── */}
      {searchIdx !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "oklch(0.18 0.015 258 / 0.4)" }}
          onClick={() => setSearchIdx(null)}
        >
          <div
            className="bg-card border border-border rounded-2xl w-full max-w-lg flex flex-col overflow-hidden"
            style={{ boxShadow: "0 20px 60px oklch(0.18 0.015 258 / 0.15), 0 4px 16px oklch(0.18 0.015 258 / 0.08)", maxHeight: "70vh" }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 px-4 py-3.5 border-b border-border">
              <Search className="w-4 h-4 text-muted-foreground shrink-0" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Nombre o código del ítem..."
                className="flex-1 text-sm bg-transparent text-foreground placeholder:text-muted-foreground/50 outline-none"
              />
              {searchLoading
                ? <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin shrink-0" />
                : searchQuery && (
                  <button onClick={() => setSearchQuery("")} className="text-muted-foreground hover:text-foreground transition-colors shrink-0">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )
              }
              <button
                onClick={() => setSearchIdx(null)}
                className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {!searchQuery.trim() || searchQuery.length < 2 ? (
                <div className="py-12 text-center">
                  <Search className="w-6 h-6 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">Escribe para buscar en el catálogo</p>
                </div>
              ) : searchLoading ? (
                <div className="py-12 flex items-center justify-center gap-2 text-muted-foreground text-sm">
                  <Loader2 className="w-4 h-4 animate-spin" /> Buscando...
                </div>
              ) : searchResults.length === 0 ? (
                <div className="py-12 text-center">
                  <p className="text-sm text-muted-foreground">Sin resultados para &quot;{searchQuery}&quot;</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">Intenta con otro nombre o código</p>
                </div>
              ) : (
                <div className="py-1">
                  {searchResults.map(item => (
                    <button
                      key={item.internalId}
                      onClick={() => selectFromSearch(searchIdx, item)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-secondary/60 transition-colors text-left group"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{item.name || item.itemid}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          {item.itemid && <span className="text-[11px] font-mono text-muted-foreground">{item.itemid}</span>}
                          {item.unit && <span className="text-[11px] text-muted-foreground/60">· {item.unit}</span>}
                        </div>
                      </div>
                      <CheckCircle2 className="w-4 h-4 text-primary opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="px-4 py-2 border-t border-border bg-secondary/30">
              <p className="text-[11px] text-muted-foreground">
                {searchResults.length > 0
                  ? `${searchResults.length} resultado${searchResults.length !== 1 ? "s" : ""} · Clic para seleccionar`
                  : "Busca por nombre de ítem o código"}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Main layout ──────────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <InvoiceHead
          title={[doc.invoice_number ? `Factura ${doc.invoice_number}` : "Factura sin número", vendorName || doc.vendor.name].filter(Boolean).join(" · ")}
          status="review"
          statusDetail={!vendorId ? "falta el proveedor" : missingCount > 0 ? `${missingCount} línea${missingCount === 1 ? "" : "s"} sin ítem` : null}
          meta={[isCfdi ? "CFDI" : "Factura en PDF", subsidiaryName && `subsidiaria ${subsidiaryName}`, ruleName && `regla «${ruleName}»`, `confianza de lectura ${overallPct} %`]}
          stages={stages}
          current={tab}
        />

        {tab === "lines" ? (
          <div className={cn("mt-4.5 grid min-h-0 flex-1 border-t border-border", storageKey && "lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]")}>
            {storageKey && (
              <div className="hidden min-h-0 flex-col overflow-hidden bg-[#E9E6E0] lg:flex">
                <DocPreview docId={docId} activeBbox={activeBbox} fileExt={fileExt} markers={markers} onMarker={(n) => setActiveLine(lines.findIndex((l) => l.line_no === n))} />
              </div>
            )}
            <div className="min-h-0 overflow-y-auto">
              <div className="flex flex-col gap-4 px-6 py-5.5 md:px-7">
                {statusReason && <Notice tone="warn" title="Motivo de la revisión">{friendlyError(statusReason)}</Notice>}

                <section aria-labelledby="inv-data">
                  <h2 id="inv-data" className="sr-only">Datos de la factura</h2>
                  <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3.5 gap-y-2 text-[13.5px]">
                    <dt className="text-muted-foreground">Proveedor</dt>
                    <dd className="relative flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      {vendorId
                        ? <span className="truncate font-semibold">{vendorName || vendorId}</span>
                        : <span className="text-tone-warn">{doc.vendor.name ? `Sin coincidencia para «${doc.vendor.name}»` : "Sin proveedor"}</span>}
                      {otherVendors.length > 0 && (
                        <button type="button" onClick={() => setVendorCandidatesOpen((o) => !o)} className="text-[13px] text-link hover:underline" aria-expanded={vendorCandidatesOpen}>
                          {otherVendors.length} sugerencia{otherVendors.length === 1 ? "" : "s"}
                        </button>
                      )}
                      <button type="button" onClick={() => setVendorSearchOpen(true)} className="text-[13px] text-link hover:underline">{vendorId ? "Cambiar" : "Buscar"}</button>
                      {vendorCandidatesOpen && otherVendors.length > 0 && (
                        <div className="absolute left-0 top-full z-30 mt-1 w-72 overflow-hidden rounded-xl border border-border bg-card shadow-[0_8px_32px_rgba(30,32,41,0.12)]">
                          {otherVendors.map((v) => (
                            <button key={v.internal_id} type="button" onClick={() => selectVendor(v.internal_id, v.name)} className="block w-full border-b border-line-soft px-3 py-2 text-left last:border-0 hover:bg-secondary/50">
                              <span className="block truncate text-[13px] font-medium">{v.name}</span>
                              {v.entityid && v.entityid !== v.name && <span className="font-mono text-[11px] text-muted-foreground">{v.entityid}</span>}
                            </button>
                          ))}
                        </div>
                      )}
                    </dd>
                    {([["Fecha", doc.invoice_date], ["Vence", doc.due_date], ["OC en la factura", doc.purchase_order]] as const).filter(([, v]) => v).map(([k, v]) => (
                      <Fragment key={k}><dt className="text-muted-foreground">{k}</dt><dd className="tabular-nums">{v}</dd></Fragment>
                    ))}
                    {payload.catalogs.locations.length > 0 && (
                      <>
                        <dt className="self-center text-muted-foreground">Ubicación</dt>
                        <dd className="max-w-64">
                          <SelectMenu value={locationId} onChange={setLocationId} ariaLabel="Ubicación" placeholder="Sin ubicación"
                            options={[{ value: "", label: "Sin ubicación" }, ...payload.catalogs.locations.map((loc) => ({ value: loc.internal_id, label: loc.name }))]} />
                        </dd>
                      </>
                    )}
                  </dl>
                </section>

                <section aria-labelledby="inv-lines">
                  <div className="flex items-baseline justify-between gap-3">
                    <h2 id="inv-lines" className="text-[15px] font-semibold">Líneas</h2>
                    <span className="text-[12.5px] text-muted-foreground">{assignedCount} de {lines.length} listas{storageKey && markers.length > 0 ? " · toca un número en el documento" : ""}</span>
                  </div>
                  <ul className="mt-2">
                    {lines.map((line, idx) => {
                      const hasItem = Boolean(line.confirmed_item_id);
                      const on = idx === selIdx;
                      const code = getDisplayCode(line);
                      const unit = unitName(line);
                      return (
                        <li key={line.line_no}>
                          <button type="button" onClick={() => setActiveLine(idx)} aria-current={on || undefined}
                            className={cn("grid w-full grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-[10px] border px-3 py-2.5 text-left text-[13.5px]",
                              on ? "border-[#EBD9AE] bg-[#FFFBF2]" : "border-transparent hover:bg-secondary/40")}>
                            <LineNo n={line.line_no} warn={!hasItem} />
                            <span className="min-w-0">
                              <span className={cn("block truncate", on && "font-semibold")}>{line.description || "Línea sin descripción"}</span>
                              <small className={cn("block truncate text-[12.5px]", hasItem ? "text-muted-foreground" : "text-tone-warn")}>
                                {hasItem ? [code ?? getDisplayName(line), unit].filter(Boolean).join(" · ") : "Sin ítem del ERP"}
                              </small>
                            </span>
                            <span className="tabular-nums text-muted-foreground">{line.amount !== null ? `$${fmt(line.amount)}` : "—"}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  <button type="button" onClick={addLine} className={btn("text", "sm", "mt-1 px-3 text-link")}><Plus />Agregar línea</button>
                </section>

                {sel && (
                  <section aria-label={`Línea ${sel.line_no}`} className="flex flex-col gap-2.5 rounded-xl border border-border bg-white p-4">
                    <span className="text-xs font-semibold uppercase tracking-[0.05em] text-foreground/75">
                      Línea {sel.line_no} · {sel.quantity} × {sel.rate !== null ? `$${fmt(sel.rate)}` : "sin precio"}
                    </span>
                    {sel.confirmed_item_id ? (
                      <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-[10px] border border-[#CFE7E3] bg-[#F1F8F7] px-3 py-2.5 text-[13.5px]">
                        <span className="min-w-0">
                          <b className="block truncate font-semibold">{[getDisplayCode(sel), getDisplayName(sel)].filter(Boolean).join(" · ")}</b>
                          <span className="text-[12.5px] text-muted-foreground">
                            {sel.recommendation_source === "memory" && selCandidate ? "Aprendido de facturas anteriores" : selCandidate ? "Sugerido" : "Elegido del catálogo"}
                          </span>
                        </span>
                        {selCandidate && selCandidate.unit_ids.length > 1 ? (
                          <SelectMenu value={sel.confirmed_unit_id ?? ""} onChange={(v) => setLineUnit(selIdx, v)} leadingLabel="Unidad" ariaLabel="Unidad de medida" align="right" className="w-52 shrink-0"
                            options={selCandidate.unit_ids.map((uid, i) => ({ value: uid, label: selCandidate.unit_names[i] || uid }))} />
                        ) : unitName(sel) ? <span className="text-[12.5px] text-muted-foreground">Unidad {unitName(sel)}</span> : null}
                      </div>
                    ) : sel.candidates.length === 0 ? (
                      <p className="text-[13.5px] text-muted-foreground">Sin coincidencias en el catálogo del ERP. Búscalo a mano.</p>
                    ) : null}
                    {selOthers.length > 0 && (
                      <ul className="flex flex-col gap-1.5">
                        {selOthers.slice(0, 4).map((c, i) => (
                          <li key={c.internal_id} className={cn("flex items-center justify-between gap-2.5 rounded-[10px] px-3 py-2 text-[13.5px]", !sel.confirmed_item_id && i === 0 ? "border border-[#CFE7E3] bg-[#F1F8F7]" : "border border-border")}>
                            <span className="min-w-0">
                              <b className="block truncate font-semibold">{[c.itemid && c.itemid !== c.name ? c.itemid : null, c.name || c.itemid].filter(Boolean).join(" · ")}</b>
                              <span className="text-[12.5px] text-muted-foreground">{c.memory_source ? "Aprendido" : !sel.confirmed_item_id && i === 0 ? "Sugerido" : "Otra opción"}{c.unit ? ` · unidad ${c.unit}` : ""}</span>
                            </span>
                            <button type="button" onClick={() => selectFromCandidate(selIdx, c.internal_id)} className={btn(!sel.confirmed_item_id && i === 0 ? "primary" : "secondary", "sm")}>Usar</button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => setSearchIdx(selIdx)} className={btn("text", "sm", "px-0 text-link")}><Search />Buscar otro ítem</button>
                      <button type="button" onClick={() => deleteLine(selIdx)} className={btn("text", "sm", "ml-auto px-0 hover:text-tone-err")}><Trash2 />Quitar línea</button>
                    </div>
                  </section>
                )}

                <p className="flex flex-wrap justify-between gap-2 border-t border-border pt-2.5 text-[13.5px] tabular-nums">
                  <span>Total ${fmt(Number(doc.totals.total))} {doc.currency}</span>
                  {balance === null ? null : balance.ok
                    ? <span className="font-semibold text-tone-ok">✓ Las líneas cuadran con el documento</span>
                    : <span className="font-semibold text-tone-warn">Las líneas suman ${fmt(balance.sum)}; el subtotal es ${fmt(balance.expected)}</span>}
                </p>
                {missingCount > 0 && (
                  <p className="text-[12.5px] text-tone-warn">{missingCount} línea{missingCount === 1 ? "" : "s"} sin ítem se omitirá{missingCount === 1 ? "" : "n"} al enviar. Asígnales un ítem o quítalas.</p>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-4.5 min-h-0 flex-1 overflow-y-auto border-t border-border">
            <div className="flex max-w-[980px] flex-col gap-4 px-6 py-5.5 md:px-8">
              {tab === "po" && (
                poEnabled ? (
                  <>
                    {vendorId ? (
                      <PoPicker
                        requirement={poMatchingEnabled ? vendorRule?.poRequirement ?? null : null}
                        vendorName={vendorName}
                        openPOs={purchaseOrders}
                        suggestions={poMatchingEnabled ? poSuggestions : []}
                        selectedId={poId}
                        onSelect={choosePo}
                        loading={purchaseOrdersLoading}
                        error={purchaseOrdersError || null}
                        invoiceTotal={Number(doc.totals.total) || 0}
                        toleranceLabel={tolerance ? (tolerance.totalType === "percent" ? `${tolerance.total}%` : tolerance.totalType === "amount" ? `$${fmt(tolerance.total)}` : "0") : null}
                        disabled={submitting}
                      />
                    ) : (
                      <p className="text-sm text-muted-foreground">Elige primero el proveedor en <button type="button" className="text-link hover:underline" onClick={() => selectTab("lines")}>Datos y líneas</button> para ver sus órdenes abiertas.</p>
                    )}
                    {poMatchingEnabled && poId && compareError && <Notice tone="err" title="No se pudo comparar con la OC">{compareError}</Notice>}
                    {poMatchingEnabled && poId && comparison && comparison.poInternalId === poId && (
                      <PoComparisonCard
                        comparison={comparison}
                        itemCodes={Object.fromEntries(validLines.map((l, i) => [i, getDisplayCode(l) ?? getDisplayName(l)]))}
                        tolerance={tolerance}
                        requireReceipt={requireReceipt}
                        loading={compareLoading}
                      />
                    )}
                    {poMatchingEnabled && poId && !comparison && compareLoading && (
                      <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Comparando la factura con la OC…</p>
                    )}
                  </>
                ) : <p className="text-sm text-muted-foreground">La relación con órdenes de compra no está activa para tu empresa.</p>
              )}

              {tab === "fiscal" && (
                apChecks?.fiscal
                  ? <FiscalPanel fiscal={apChecks.fiscal} />
                  : <p className="text-sm text-muted-foreground">{isCfdi ? "El CFDI todavía no se ha consultado ante el SAT." : "Las facturas en PDF no llevan validación fiscal."}</p>
              )}

              {tab === "erp" && (
                <section className="flex flex-col gap-3">
                  <h2 className="text-[15px] font-semibold">Lo que se va a crear en el ERP</h2>
                  <dl className="grid grid-cols-[150px_minmax(0,1fr)] gap-x-3.5 gap-y-2 text-[13.5px]">
                    <dt className="text-muted-foreground">Proveedor</dt><dd>{vendorName || <span className="text-tone-warn">Sin elegir</span>}</dd>
                    <dt className="text-muted-foreground">Factura</dt><dd>{doc.invoice_number ?? "Sin número"} · {doc.invoice_date}</dd>
                    <dt className="text-muted-foreground">Orden de compra</dt><dd>{poId ? (comparison?.poInternalId === poId ? comparison.poTranid : purchaseOrders.find((p) => p.internal_id === poId)?.tranid ?? poId) : "Sin OC"}</dd>
                    <dt className="text-muted-foreground">Ubicación</dt><dd>{payload.catalogs.locations.find((l) => l.internal_id === locationId)?.name ?? "Sin ubicación"}</dd>
                    <dt className="text-muted-foreground">Líneas</dt><dd>{assignedCount} con ítem{missingCount > 0 ? ` · ${missingCount} se omiten` : ""}</dd>
                    <dt className="text-muted-foreground">Total</dt><dd className="tabular-nums">${fmt(Number(doc.totals.total))} {doc.currency}</dd>
                  </dl>
                  {sandboxTest && (
                    <SandboxTestSend docId={docId} history={testSends} disabled={submitting} buildBody={() => (vendorId && validLines.length ? reviewBody() : null)} />
                  )}
                </section>
              )}
            </div>
          </div>
        )}

        {/* ── Barra de acción: qué pasa al enviar ─────────────────────────── */}
        <div className={cn(
          "flex shrink-0 flex-wrap items-center gap-3 border-t px-6 py-3 md:px-8",
          action.tone === "err" ? "border-tone-err/20 bg-tone-err-bg" : action.tone === "warn" ? "border-tone-warn/20 bg-tone-warn-bg" : "border-border bg-card",
        )}>
          {action.tone !== "none" && <AlertCircle className={cn("size-4 shrink-0", action.tone === "err" ? "text-tone-err" : "text-tone-warn")} aria-hidden="true" />}
          <p className="min-w-[240px] flex-1 text-[13.5px]">{submitError ? <span className="text-tone-err">{submitError}</span> : action.message}</p>
          {sandboxTest && tab !== "erp" && (
            <SandboxTestSend docId={docId} compact history={testSends} disabled={submitting} buildBody={() => (vendorId && validLines.length ? reviewBody() : null)} />
          )}
          {action.secondary && (
            <button type="button" onClick={action.secondary.run} disabled={submitting || !vendorId} className={btn("secondary")}>{action.secondary.label}</button>
          )}
          <button type="button" onClick={action.primary.run} disabled={submitting || !vendorId || action.primary.disabled} className={btn("primary")}>
            {submitting && <Loader2 className="animate-spin" />}
            {submitting ? "Enviando…" : action.primary.label}
          </button>
        </div>
      </div>
    </>
  );
}

function LineNo({ n, warn }: { n: number; warn: boolean }) {
  return (
    <span className={cn("inline-flex size-[18px] items-center justify-center rounded-full text-[10px] font-bold text-white", warn ? "bg-[#B07C0E]" : "bg-primary")}>
      {n}<span className="sr-only">{warn ? ", sin ítem" : ""}</span>
    </span>
  );
}
