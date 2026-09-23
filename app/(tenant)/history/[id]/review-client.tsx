"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  CheckCircle2, AlertTriangle, Loader2, ChevronLeft,
  Building2, Sparkles,
  ChevronDown, ChevronUp, Search, X, Eye, EyeOff,
  Trash2, Plus, ExternalLink, AlertCircle,
} from "lucide-react";
import type { BBox } from "@/lib/workflow/types";
import type { ApChecks } from "@/lib/workflow/ap-checks";
import type { PoComparison, PoOutcome, PoSuggestion } from "@/lib/workflow/po-match";
import type { EffectiveVendorRule } from "@/lib/workflow/vendor-rules";
import { DocPreview } from "./doc-preview-lazy";
import { SelectMenu } from "@/components/ui/select-menu";
import { Badge, Card, FiscalPanel, PoComparisonCard, PoPicker } from "./ap-panels";

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
  payload,
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
  payload: ReviewPayload;
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

  const [openDropdown, setOpenDropdown] = useState<number | null>(null);

  // Active line for document preview
  const [activeLine, setActiveLine] = useState<number | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  // Resizable preview panel
  const [previewWidth, setPreviewWidth] = useState(560);
  const isDragging    = useRef(false);
  const dragStartX    = useRef(0);
  const dragStartWidth = useRef(0);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current    = true;
    dragStartX.current    = e.clientX;
    dragStartWidth.current = previewWidth;
  }, [previewWidth]);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!isDragging.current) return;
      const delta = e.clientX - dragStartX.current;
      const next  = Math.min(1200, Math.max(240, dragStartWidth.current + delta));
      setPreviewWidth(next);
    }
    function onMouseUp() { isDragging.current = false; }
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup",   onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup",   onMouseUp);
    };
  }, []);

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
    setOpenDropdown(null);
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

  async function handleApprove(opts: { requestApproval?: boolean } = {}) {
    setSubmitError("");
    if (!vendorId) { setSubmitError("Selecciona un proveedor del ERP antes de aprobar."); return; }
    if (!validLines.length) { setSubmitError("Asigna al menos un ítem del ERP para poder aprobar."); return; }
    const current = comparison && comparison.poInternalId === poId ? comparison : null;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/v1/workflow/${docId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendor_internal_id:   vendorId,
          vendor_name:          vendorName || null,
          invoice_number:       doc.invoice_number,
          invoice_date:         doc.invoice_date,
          due_date:             doc.due_date,
          currency:             doc.currency,
          location_internal_id: locationId || null,
          po_internal_id:       poId || null,
          request_approval:     opts.requestApproval === true,
          line_items: lineItems.map((l, i) => ({
            ...l,
            po_line: current?.lines.find(c => c.index === i)?.poLine ?? null,
          })),
        }),
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
  const activeBbox    = activeLine !== null ? lines[activeLine]?.bbox : undefined;

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

      {/* Backdrop for candidates dropdown */}
      {openDropdown !== null && (
        <div className="fixed inset-0 z-20" onClick={() => setOpenDropdown(null)} />
      )}

      {/* ── Main layout ──────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Page header */}
        <div className="h-14 border-b border-border px-6 flex items-center gap-3 shrink-0 bg-card">
          <button
            onClick={() => router.back()}
            aria-label="Volver"
            className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="min-w-0">
            <h1 className="text-sm font-semibold text-foreground leading-tight truncate">
              {doc.invoice_number ? `Factura ${doc.invoice_number}` : "Revisión de extracción"}
            </h1>
            <p className="text-[11px] text-muted-foreground">Documento #{docId} · Verifica antes de enviar al ERP</p>
          </div>
          <Badge tone="warn">En revisión</Badge>
          {vendorRule && <Badge tone="info" className="hidden md:inline-flex">Regla: {vendorRule.ruleLabel.replace(/^(Categoría|Proveedor): /, "")}</Badge>}
          <span className="ml-auto hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground">
            <Sparkles className="w-3 h-3" />
            Confianza de extracción
            <strong className={cn("tabular-nums", overallPct >= 80 ? "text-success" : overallPct >= 60 ? "text-warning" : "text-destructive")}>{overallPct}%</strong>
          </span>
          <button
            onClick={() => storageKey ? setPreviewOpen(p => !p) : undefined}
            disabled={!storageKey}
            title={!storageKey ? "El archivo no fue guardado. Activa la función de almacenamiento de documentos." : undefined}
            className={cn(
              "flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-all shrink-0",
              previewOpen && storageKey
                ? "bg-primary text-primary-foreground border-primary/50"
                : storageKey
                ? "text-muted-foreground border-border hover:text-foreground hover:bg-secondary"
                : "text-muted-foreground/40 border-border/40 cursor-not-allowed"
            )}
          >
            {previewOpen && storageKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            Ver documento
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 flex overflow-hidden">

          {/* ── Document preview panel (left) ─────────────────────────────── */}
          {previewOpen && storageKey && (
            <div className="shrink-0 flex flex-col overflow-hidden border-r border-border" style={{ width: previewWidth }}>
              <DocPreview docId={docId} activeBbox={activeBbox} fileExt={fileExt} />
            </div>
          )}
          {previewOpen && storageKey && (
            <div
              onMouseDown={handleDragStart}
              className="shrink-0 w-1 bg-border hover:bg-primary/40 cursor-col-resize transition-colors active:bg-primary/60"
              style={{ touchAction: "none" }}
            />
          )}

          {/* ── Review column ─────────────────────────────────────────────── */}
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto">
              <div className="p-5 flex flex-col gap-3.5 max-w-[1180px]">

                {statusReason && (
                  <div className="flex items-start gap-2 rounded-lg border border-warning/25 bg-warning/5 px-3.5 py-2.5 text-xs text-foreground">
                    <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0 text-warning" />
                    <span><span className="font-semibold">Motivo de la revisión:</span> {statusReason}</span>
                  </div>
                )}

                {/* Summary strip */}
                <Card className="px-4 py-3.5 flex flex-wrap items-start gap-x-7 gap-y-3">
                  <div className="relative min-w-[200px] flex-1">
                    <span className="block text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-foreground mb-1">Proveedor</span>
                    <div className="flex items-center gap-2">
                      {vendorId ? (
                        <span className="flex items-center gap-1.5 min-w-0 text-[0.8125rem] font-semibold text-foreground">
                          <CheckCircle2 className="w-3.5 h-3.5 text-primary shrink-0" />
                          <span className="truncate">{vendorName || vendorId}</span>
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 text-[0.8125rem] text-warning">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          {doc.vendor.name ? `Sin coincidencia para “${doc.vendor.name}”` : "Sin proveedor seleccionado"}
                        </span>
                      )}
                      {doc.vendor.options.filter(v => v.internal_id !== vendorId).length > 0 && (
                        <button
                          onClick={() => setVendorCandidatesOpen(o => !o)}
                          className="flex items-center gap-0.5 text-[11px] font-semibold text-primary hover:text-primary/75 shrink-0"
                          aria-label="Otras sugerencias de proveedor"
                        >
                          {vendorCandidatesOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          {doc.vendor.options.filter(v => v.internal_id !== vendorId).length}
                        </button>
                      )}
                      <button onClick={() => setVendorSearchOpen(true)} className="flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline shrink-0">
                        <Search className="w-3 h-3" />{vendorId ? "Cambiar" : "Buscar"}
                      </button>
                    </div>
                    {vendorCandidatesOpen && doc.vendor.options.filter(v => v.internal_id !== vendorId).length > 0 && (
                      <div
                        className="absolute top-full left-0 w-72 mt-1 z-30 bg-card border border-border rounded-xl overflow-hidden"
                        style={{ boxShadow: "0 8px 32px oklch(0.18 0.015 258 / 0.12), 0 2px 8px oklch(0.18 0.015 258 / 0.06)" }}
                      >
                        <div className="px-3 py-1.5 border-b border-border/60 bg-secondary/40">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">Otras sugerencias</p>
                        </div>
                        {doc.vendor.options.filter(v => v.internal_id !== vendorId).map(v => (
                          <button
                            key={v.internal_id}
                            onClick={() => selectVendor(v.internal_id, v.name)}
                            className="w-full flex items-start gap-2 px-3 py-2 hover:bg-secondary/50 transition-colors text-left border-b border-border/40 last:border-0"
                          >
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-foreground truncate">{v.name}</p>
                              {v.entityid && v.entityid !== v.name && <p className="text-[10px] font-mono text-muted-foreground">{v.entityid}</p>}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {[
                    { label: "Fecha", value: doc.invoice_date },
                    { label: "Vence", value: doc.due_date },
                    { label: "Total", value: `$${fmt(Number(doc.totals.total))} ${doc.currency}` },
                    { label: "OC en la factura", value: doc.purchase_order },
                  ].filter(r => r.value).map(({ label, value }) => (
                    <div key={label}>
                      <span className="block text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-foreground mb-1">{label}</span>
                      <span className="text-[0.8125rem] font-semibold text-foreground tabular-nums">{value}</span>
                    </div>
                  ))}
                  {payload.catalogs.locations.length > 0 && (
                    <div className="w-52">
                      <span className="block text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-foreground mb-1">Ubicación</span>
                      <SelectMenu
                        value={locationId}
                        onChange={setLocationId}
                        ariaLabel="Ubicación"
                        placeholder="— Sin ubicación —"
                        options={[
                          { value: "", label: "— Sin ubicación —" },
                          ...payload.catalogs.locations.map(loc => ({ value: loc.internal_id, label: loc.name })),
                        ]}
                      />
                    </div>
                  )}
                </Card>

                {apChecks?.fiscal && <FiscalPanel fiscal={apChecks.fiscal} />}

                {poEnabled && (
                  vendorId ? (
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
                    <Card className="p-4 text-xs text-muted-foreground">Selecciona el proveedor para consultar sus órdenes de compra abiertas.</Card>
                  )
                )}

                {poMatchingEnabled && poId && compareError && (
                  <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{compareError}</p>
                )}
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
                  <Card className="p-4 flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="w-3.5 h-3.5 animate-spin" />Comparando la factura con la OC…</Card>
                )}

                {/* Lines */}
                <Card className="overflow-hidden">
                  <div className="px-4 py-3 border-b border-border flex flex-wrap items-center gap-3 text-xs">
                    <h2 className="text-sm font-semibold text-foreground mr-1">Líneas del documento</h2>
                    <span className="text-muted-foreground"><span className="font-medium text-foreground">{lines.length}</span> línea{lines.length !== 1 ? "s" : ""}</span>
                    <span className="flex items-center gap-1 font-medium text-success"><CheckCircle2 className="w-3 h-3" />{assignedCount} con ítem del ERP</span>
                    {missingCount > 0 && <span className="flex items-center gap-1 font-medium text-warning"><AlertTriangle className="w-3 h-3" />{missingCount} sin ítem</span>}
                  </div>
                  <div className="divide-y divide-border/60">
              {lines.map((line, idx) => {
                const candidateItem   = getCandidateItem(line);
                const displayName     = getDisplayName(line);
                const displayCode     = getDisplayCode(line);
                const hasItem         = Boolean(line.confirmed_item_id);
                const fromSearch      = hasItem && !candidateItem;
                const otherCandidates = line.candidates.filter(c => c.internal_id !== line.confirmed_item_id);
                const showUnitSelect  = candidateItem && candidateItem.unit_ids.length > 1;
                const isActive        = activeLine === idx;

                return (
                  <div
                    key={line.line_no}
                    className={cn(
                      "group px-5 py-2 transition-colors cursor-pointer",
                      isActive
                        ? "bg-primary/5"
                        : hasItem ? "hover:bg-secondary/20" : "hover:bg-secondary/30",
                      !hasItem && !isActive && "bg-amber-50/30"
                    )}
                    style={!hasItem && !isActive ? { backgroundColor: "oklch(0.97 0.012 85)" } : undefined}
                    onClick={() => {
                      setActiveLine(idx);
                      if (storageKey && !previewOpen) setPreviewOpen(true);
                    }}
                  >
                    {/* Row 1: line number + description + meta + status */}
                    <div className="flex items-center gap-2.5">
                      <span className="text-[10px] font-mono font-medium text-muted-foreground/60 bg-secondary px-1.5 py-0.5 rounded min-w-[22px] inline-block text-center tabular-nums shrink-0">
                        {line.line_no}
                      </span>

                      <div className="flex-1 min-w-0 flex items-baseline gap-2.5 overflow-hidden">
                        <p className="text-sm font-medium text-foreground truncate leading-none">
                          {line.description}
                        </p>
                        <span className="text-[11px] text-muted-foreground shrink-0 tabular-nums">
                          ×{line.quantity}
                          {line.amount !== null && ` · $${fmt(line.amount)}`}
                        </span>
                        {line.recommendation_source === "memory" && (
                          <span
                            className="text-[10px] font-medium flex items-center gap-0.5 px-1 py-0.5 rounded shrink-0"
                            style={{ backgroundColor: "oklch(0.93 0.05 182)", color: "oklch(0.35 0.15 182)" }}
                          >
                            <Sparkles className="w-2.5 h-2.5" />
                          </span>
                        )}
                      </div>

                      <div className={cn(
                        "w-4 h-4 rounded-full flex items-center justify-center shrink-0",
                        hasItem ? "bg-emerald-500/15" : "bg-amber-500/15"
                      )}>
                        {hasItem
                          ? <CheckCircle2 className="w-2.5 h-2.5 text-emerald-600" />
                          : <AlertTriangle className="w-2.5 h-2.5" style={{ color: "oklch(0.58 0.16 85)" }} />
                        }
                      </div>
                    </div>

                    {/* Row 2: item assignment */}
                    <div className="flex items-center gap-1.5 mt-1.5 ml-7" onClick={e => e.stopPropagation()}>
                      {/* Item chip or empty state */}
                      <div className="flex-1 min-w-0 relative">
                        {hasItem ? (
                          <>
                            <div
                              className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs"
                              style={{ backgroundColor: "oklch(0.97 0.02 182)", borderColor: "oklch(0.48 0.15 182 / 0.25)" }}
                            >
                              <CheckCircle2 className="w-3 h-3 text-primary shrink-0" />
                              <div className="flex-1 min-w-0">
                                <span className="font-semibold text-foreground block truncate leading-tight">
                                  {displayName}
                                </span>
                                {displayCode && (
                                  <span className="font-mono text-[10px] text-muted-foreground">[{displayCode}]</span>
                                )}
                              </div>
                              {fromSearch && (
                                <span className="text-[10px] text-muted-foreground shrink-0 flex items-center gap-0.5">
                                  <Search className="w-2.5 h-2.5" />
                                </span>
                              )}
                              {otherCandidates.length > 0 && (
                                <button
                                  onClick={e => { e.stopPropagation(); setOpenDropdown(openDropdown === idx ? null : idx); }}
                                  className="flex items-center gap-0.5 text-[11px] font-semibold text-primary hover:text-primary/75 transition-colors shrink-0"
                                >
                                  {openDropdown === idx ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                  {otherCandidates.length}
                                </button>
                              )}
                            </div>

                            {/* Candidates dropdown */}
                            {openDropdown === idx && otherCandidates.length > 0 && (
                              <div
                                className="absolute top-full left-0 right-0 mt-1 z-30 bg-card border border-border rounded-xl overflow-hidden"
                                style={{ boxShadow: "0 8px 32px oklch(0.18 0.015 258 / 0.12), 0 2px 8px oklch(0.18 0.015 258 / 0.06)" }}
                              >
                                <div className="px-3 py-1.5 border-b border-border/60 bg-secondary/40">
                                  <p className="text-[10px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
                                    Otras sugerencias
                                  </p>
                                </div>
                                {otherCandidates.slice(0, 6).map(c => (
                                  <button
                                    key={c.internal_id}
                                    onClick={() => selectFromCandidate(idx, c.internal_id)}
                                    className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-secondary/50 transition-colors text-left border-b border-border/40 last:border-0"
                                  >
                                    <div className="flex-1 min-w-0">
                                      <p className="text-xs font-medium text-foreground truncate">{c.name || c.itemid}</p>
                                      {c.itemid && c.itemid !== c.name && (
                                        <p className="text-[10px] font-mono text-muted-foreground mt-0.5">[{c.itemid}]</p>
                                      )}
                                    </div>
                                    {c.memory_source && (
                                      <span className="text-[10px] font-medium shrink-0" style={{ color: "oklch(0.35 0.15 182)" }}>★</span>
                                    )}
                                  </button>
                                ))}
                              </div>
                            )}
                          </>
                        ) : (
                          <div
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-dashed text-xs"
                            style={{ borderColor: "oklch(0.62 0.16 85 / 0.4)", backgroundColor: "oklch(0.97 0.015 85 / 0.6)" }}
                          >
                            <AlertTriangle className="w-3 h-3 shrink-0" style={{ color: "oklch(0.58 0.16 85)" }} />
                            {line.candidates.length > 0
                              ? <button onClick={() => selectFromCandidate(idx, line.candidates[0].internal_id)} className="text-primary hover:underline font-medium">Usar sugerencia</button>
                              : <span className="text-muted-foreground">Sin coincidencias en catálogo</span>
                            }
                          </div>
                        )}
                      </div>

                      {/* Unit selector */}
                      {showUnitSelect && candidateItem && (
                        <SelectMenu
                          value={line.confirmed_unit_id ?? ""}
                          onChange={(v) => setLineUnit(idx, v)}
                          leadingLabel="Unidad"
                          ariaLabel="Unidad de medida"
                          align="right"
                          className="shrink-0 w-52"
                          options={candidateItem.unit_ids.map((uid, i) => ({
                            value: uid,
                            label: candidateItem.unit_names[i] || uid,
                          }))}
                        />
                      )}

                      {/* Single fixed unit from a candidate (only one option) */}
                      {candidateItem && candidateItem.unit_ids.length === 1 && candidateItem.unit_names[0] && (
                        <div className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 bg-secondary/50 border border-border rounded-lg text-xs text-foreground">
                          <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/70">Unidad</span>
                          {candidateItem.unit_names[0]}
                        </div>
                      )}

                      {/* Catalog unit display (single fixed unit — not selectable) */}
                      {fromSearch && line.catalog_unit_name && (
                        <div className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 bg-secondary/50 border border-border rounded-lg text-xs text-foreground">
                          <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/70">Unidad</span>
                          {line.catalog_unit_name}
                        </div>
                      )}

                      {/* Search button */}
                      <button
                        onClick={() => { setSearchIdx(idx); setOpenDropdown(null); }}
                        className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-secondary hover:border-border/80 transition-all"
                      >
                        <Search className="w-3 h-3" />
                        Buscar
                      </button>

                      {/* Delete line button */}
                      <button
                        onClick={e => { e.stopPropagation(); deleteLine(idx); }}
                        className="shrink-0 p-1.5 rounded-lg border border-transparent text-muted-foreground/40 hover:text-destructive hover:border-destructive/20 hover:bg-destructive/5 opacity-0 group-hover:opacity-100 transition-all"
                        title="Eliminar línea"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })}

              {/* Add line */}
              <div className="px-5 py-3 border-t border-border/40">
                <button
                  onClick={addLine}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary hover:bg-primary/5 px-2.5 py-1.5 rounded-lg border border-dashed border-border/60 hover:border-primary/30 transition-all w-full justify-center"
                >
                  <Plus className="w-3 h-3" />
                  Agregar línea
                </button>
              </div>
                  </div>
                  {missingCount > 0 && (
                    <div className="mx-4 mb-4 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3.5 py-2.5 text-xs font-medium text-warning">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      {missingCount} línea{missingCount !== 1 ? "s" : ""} sin ítem asignado: se omitirán al enviar al ERP. Asigna los ítems o elimina esas líneas antes de aprobar.
                    </div>
                  )}
                </Card>
                <div className="h-2" />
              </div>
            </div>

            {/* ── Action bar ──────────────────────────────────────────────── */}
            <div className={cn(
              "shrink-0 border-t px-5 py-3 flex flex-wrap items-center gap-3",
              action.tone === "err" ? "bg-destructive/5 border-destructive/20" : action.tone === "warn" ? "bg-warning/5 border-warning/25" : "bg-card border-border",
            )}>
              {action.tone !== "none" && (
                <AlertCircle className={cn("w-4 h-4 shrink-0", action.tone === "err" ? "text-destructive" : "text-warning")} aria-hidden="true" />
              )}
              <p className="flex-1 min-w-[240px] text-[0.8125rem] text-foreground">
                {submitError ? <span className="text-destructive">{submitError}</span> : action.message}
              </p>
              <button onClick={() => router.back()} disabled={submitting} className="text-xs text-muted-foreground hover:text-foreground px-2">Cancelar</button>
              {action.secondary && (
                <button
                  onClick={action.secondary.run}
                  disabled={submitting || !vendorId}
                  className="h-10 px-4 rounded-lg border border-border bg-card text-[0.8125rem] font-semibold text-foreground hover:bg-secondary disabled:opacity-50"
                >
                  {action.secondary.label}
                </button>
              )}
              <button
                onClick={action.primary.run}
                disabled={submitting || !vendorId || action.primary.disabled}
                className="h-10 px-4 inline-flex items-center gap-2 rounded-lg bg-primary text-primary-foreground text-[0.8125rem] font-semibold hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                {submitting ? "Enviando…" : action.primary.label}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
