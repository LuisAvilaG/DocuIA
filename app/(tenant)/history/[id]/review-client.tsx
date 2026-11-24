"use client";

import { useState, useEffect, useRef, useMemo, Fragment } from "react";
import Link from "next/link";
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
import { FiscalEmpty, FiscalPanel, PoComparisonCard, PoPicker } from "./ap-panels";
import type { LineMarker } from "./doc-preview";
import { InvoiceHead, ReadingConfidence, invoiceStages, type InvoiceTab } from "./invoice-head";
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
  /** Added by the reviewer: its description, quantity and price are typed in. */
  manual?: boolean;
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

const lineInput = "min-h-9 w-full rounded-lg border border-[#D6D2C8] bg-white px-2.5 text-[13.5px] text-foreground outline-none focus:border-primary read-only:bg-secondary/40";

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
  initialPoId,
  initialLocationId = null,
  canWrite = true,
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
  /** PO and location of a draft already reviewed (a document that came back to review). */
  initialPoId?: string | null;
  initialLocationId?: string | null;
  /** false for read-only roles: the document is shown but cannot be sent. */
  canWrite?: boolean;
}) {
  const router = useRouter();
  const doc = payload.document;

  const [vendorId, setVendorId]     = useState(doc.vendor.selected_internal_id ?? "");
  const [vendorName, setVendorName] = useState<string>(() => {
    const found = doc.vendor.options.find(v => v.internal_id === (doc.vendor.selected_internal_id ?? ""));
    return found?.name ?? doc.vendor.name ?? "";
  });
  const [locationId, setLocationId] = useState(initialLocationId ?? "");
  const initialPo = apChecks?.po ?? null;
  const poEnabled = poMatchingEnabled || poProcessingEnabled;
  // No PO when the PO features are off: it could not be changed and the server would refuse it.
  const [poId, setPoId] = useState(!poEnabled ? "" : initialPoId !== undefined ? initialPoId ?? "" : initialPo?.selectedPoId ?? "");
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

  // Only what the matching selected is confirmed. A line it left open (several
  // candidates) shows the first one as a suggestion to accept, not as done:
  // sent unseen, a guess would also be learned as a mapping a person confirmed.
  const [lines, setLines] = useState<ReviewLine[]>(() =>
    doc.lines.map((l) => ({
      ...l,
      confirmed_item_id: l.selected_item_id ?? null,
      confirmed_unit_id: l.selected_unit_id ?? null,
    }))
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
  const itemWindowRef = useRef<HTMLDivElement>(null);

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
    // An answer to an earlier query must not replace the results of this one.
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/v1/catalog/vendors?q=${encodeURIComponent(vendorQuery)}&subsidiaryId=${subsidiaryId}`
        );
        if (res.ok && !cancelled) {
          const data = await res.json();
          if (!cancelled) setVendorResults(data.vendors ?? []);
        }
      } finally {
        if (!cancelled) setVendorSearchLoading(false);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
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
      setSearchQuery("");
      setSearchResults([]);
    }
  }

  // The item window opens beside its line: it is brought into view, the search
  // takes the focus, and Escape or a click outside closes it.
  useEffect(() => {
    if (searchIdx === null) return;
    const t = setTimeout(() => {
      itemWindowRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      searchInputRef.current?.focus({ preventScroll: true });
    }, 60);
    function onKey(e: KeyboardEvent) {
      // A menu open inside the window (the unit) takes the first Escape.
      if (e.key === "Escape" && !(e.target as HTMLElement | null)?.closest?.('[role="listbox"]')) setSearchIdx(null);
    }
    function onDown(e: MouseEvent) {
      const el = e.target as HTMLElement | null;
      // A line toggles its own window; the numbers on the document open another line.
      if (!el || itemWindowRef.current?.contains(el) || el.closest("[data-line-row], [data-doc-preview]")) return;
      setSearchIdx(null);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => { clearTimeout(t); document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onDown); };
  }, [searchIdx]);

  // Search results make the window taller: its buttons stay in view.
  useEffect(() => {
    if (searchIdx !== null) itemWindowRef.current?.scrollIntoView({ block: "nearest" });
  }, [searchIdx, searchResults.length, searchLoading]);

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
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/v1/catalog/items?q=${encodeURIComponent(searchQuery)}&subsidiaryId=${subsidiaryId}`
        );
        if (res.ok && !cancelled) {
          const data = await res.json();
          if (!cancelled) setSearchResults(data.items ?? []);
        }
      } finally {
        if (!cancelled) setSearchLoading(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
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
    setSearchQuery("");
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
    setSearchIdx(null);
  }

  // Description, quantity and price of a line added by hand (or read without a price).
  function editLine(idx: number, patch: Partial<Pick<ReviewLine, "description" | "quantity" | "rate">>) {
    setLines(prev => prev.map((l, i) => {
      if (i !== idx) return l;
      const next = { ...l, ...patch };
      return { ...next, amount: next.rate !== null ? Math.round(next.quantity * next.rate * 100) / 100 : null };
    }));
  }

  function addLine() {
    setActiveLine(lines.length);
    setSearchIdx(lines.length);
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
        manual: true,
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
  // The comparison that came with the document is indexed over every line read;
  // the one used here is always made over the lines on screen, so it is asked
  // again on load and after every change. Until it answers, nothing is sent.
  const [comparedKey, setComparedKey] = useState("");
  const [compareAttempt, setCompareAttempt] = useState(0);
  const compareStale = Boolean(compareKey) && compareKey !== comparedKey;

  useEffect(() => {
    if (!compareKey || compareKey === comparedKey) return;
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
        setComparedKey(compareKey);
        setComparison(data.comparison ?? null);
        setOutcome(data.outcome ?? null);
      } catch {
        if (!cancelled) setCompareError("No se pudo conectar con el servidor");
      } finally {
        if (!cancelled) setCompareLoading(false);
      }
    }, 500);
    return () => { cancelled = true; clearTimeout(t); };
  }, [compareKey, comparedKey, compareAttempt, docId, poId, vendorId, lineItems]);

  function choosePo(id: string) {
    setPoId(id);
    if (!id) { setComparison(null); setOutcome(null); setCompareError(""); }
  }

  // ── Submit ────────────────────────────────────────────────────────────────

  // The draft as the reviewer sees it: what approval posts and what a sandbox
  // test send uses, so both go to the ERP with the same lines.
  function reviewBody(): Record<string, unknown> {
    const current = !compareStale && comparison && comparison.poInternalId === poId ? comparison : null;
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
    if (validLines.some(l => l.rate === null && l.amount === null)) { setSubmitError("Hay líneas sin precio. Captura cantidad y precio, o quítalas."); return; }
    if (validLines.some(l => l.manual && (!l.description.trim() || l.quantity <= 0))) { setSubmitError("Completa la descripción y la cantidad de la línea agregada."); return; }
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
  const unpricedCount = validLines.filter(l => l.rate === null && l.amount === null).length;
  const missingCount  = lines.length - assignedCount;
  const overallPct    = Math.round(payload.confidence.overall * 100);

  // ── Action bar: what happens when the reviewer sends the document ─────────
  type ActionButton = { label: string; run: () => void; disabled?: boolean };
  const liveOutcome = poMatchingEnabled && poId && !compareStale && comparison?.poInternalId === poId ? outcome : null;
  const parksForApproval = approvalWorkflow && !canApprove;
  const sendLabel = parksForApproval ? "Enviar a aprobación" : "Aprobar y enviar al ERP";
  const ruleName = vendorRule?.ruleId ? vendorRule.ruleLabel.replace(/^(Categoría|Proveedor): /, "") : null;
  const action: { tone: "none" | "warn" | "err"; message: React.ReactNode; primary: ActionButton; secondary?: ActionButton } = (() => {
    const send = () => { void handleApprove(); };
    const toApprover = () => { void handleApprove({ requestApproval: true }); };
    if (poMatchingEnabled && vendorRule?.poRequirement === "required" && !poId) {
      return { tone: "err", message: "Este proveedor exige orden de compra: elige una para continuar.", primary: { label: sendLabel, run: send, disabled: true } };
    }
    if (poMatchingEnabled && poId && compareError) {
      return { tone: "err", message: <>No se pudo comparar con la OC: {compareError}</>, primary: { label: "Reintentar comparación", run: () => setCompareAttempt(n => n + 1) } };
    }
    if (poMatchingEnabled && poId && (compareLoading || compareStale)) {
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
            : parksForApproval ? "Al enviarla, un aprobador la revisará antes de crearla en el ERP."
            // En «Envío al ERP» los datos ya están a la vista: solo se avisa de lo que puede fallar.
            : tab === "erp" && !locationId && payload.catalogs.locations.length > 0 ? "Si tu ERP exige ubicación, rechazará esta factura."
            : "Verifica proveedor, OC y líneas antes de enviar.",
          primary: { label: missingCount > 0 ? `${sendLabel} (${missingCount} sin ítem)` : sendLabel, run: send },
        };
    }
  })();

  // ── Vista ─────────────────────────────────────────────────────────────────
  const firstMissing = lines.findIndex((l) => !l.confirmed_item_id);
  const selIdx = activeLine !== null && activeLine >= 0 && activeLine < lines.length ? activeLine : Math.max(0, firstMissing);
  const sel = lines[selIdx] ?? null;
  /** Opens the item window of a line (or moves it there). */
  const openLine = (i: number) => { setActiveLine(i); setSearchIdx(i); };
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
  // «Envío al ERP»: lo que llevará la factura de proveedor.
  const erpLocation = payload.catalogs.locations.find((l) => l.internal_id === locationId)?.name ?? null;
  const erpPo = poId ? (comparison?.poInternalId === poId ? comparison.poTranid : purchaseOrders.find((p) => p.internal_id === poId)?.tranid ?? poId) : null;
  const stages: Stage[] = invoiceStages({
    lines: { total: lines.length, missing: missingCount },
    vendorMissing: !vendorId,
    po: {
      enabled: poEnabled,
      required: poMatchingEnabled && vendorRule?.poRequirement === "required",
      selected: poId || null,
      comparison: !compareStale && comparison?.poInternalId === poId ? comparison : null,
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
                <p className="text-sm font-semibold text-foreground">{submitResult.netsuiteId ? "Documento enviado al ERP" : "Validado en modo prueba"}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{submitResult.netsuiteId ? "La transacción fue creada exitosamente" : "El ERP aceptó los datos; no se creó ninguna transacción."}</p>
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

      {/* ── Main layout ──────────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <InvoiceHead
          title={[doc.invoice_number ? `Factura ${doc.invoice_number}` : "Factura sin número", vendorName || doc.vendor.name].filter(Boolean).join(" · ")}
          status="review"
          statusDetail={!vendorId ? "falta el proveedor" : missingCount > 0 ? `${missingCount} línea${missingCount === 1 ? "" : "s"} sin ítem` : null}
          meta={[isCfdi ? "CFDI" : "Factura en PDF", subsidiaryName && `subsidiaria ${subsidiaryName}`, ruleName && `regla «${ruleName}»`]}
          actions={<ReadingConfidence pct={overallPct} reason={friendlyError(statusReason)} />}
          stages={stages}
          current={tab}
        />

        {tab === "lines" ? (
          <div className={cn("mt-4.5 grid min-h-0 flex-1 border-t border-border", storageKey && "lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]")}>
            {storageKey && (
              <div data-doc-preview className="hidden min-h-0 flex-col overflow-hidden bg-[#E9E6E0] lg:flex">
                <DocPreview docId={docId} activeBbox={activeBbox} fileExt={fileExt} markers={markers} onMarker={(n) => { const i = lines.findIndex((l) => l.line_no === n); if (i >= 0) openLine(i); }} />
              </div>
            )}
            <div className="min-h-0 overflow-y-auto">
              <div className="flex flex-col gap-4 px-6 py-5.5 md:px-7">
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
                    <dt className="self-center text-muted-foreground">Ubicación</dt>
                    <dd className="max-w-64">
                      {payload.catalogs.locations.length > 0 ? (
                        <SelectMenu value={locationId} onChange={setLocationId} ariaLabel="Ubicación" placeholder="Sin ubicación"
                          options={[{ value: "", label: "Sin ubicación" }, ...payload.catalogs.locations.map((loc) => ({ value: loc.internal_id, label: loc.name }))]} />
                      ) : (
                        <span className="text-muted-foreground">Esta subsidiaria no tiene ubicaciones del ERP. <Link href="/catalogs" className="font-semibold text-link hover:underline">Sincroniza los catálogos</Link> para elegir una.</span>
                      )}
                    </dd>
                  </dl>
                </section>

                <section aria-labelledby="inv-lines">
                  <div className="flex items-baseline justify-between gap-3 border-t border-border pt-3.5">
                    <h2 id="inv-lines" className="text-[15px] font-semibold">Líneas</h2>
                    <span className="text-[12.5px] text-muted-foreground">{assignedCount} de {lines.length} listas · toca una línea para cambiar su ítem</span>
                  </div>
                  <ul className="relative mt-2">
                    {lines.map((line, idx) => {
                      const hasItem = Boolean(line.confirmed_item_id);
                      const on = idx === selIdx;
                      const open = idx === searchIdx;
                      const code = getDisplayCode(line);
                      const unit = unitName(line);
                      const candidate = getCandidateItem(line);
                      const others = line.candidates.filter((c) => c.internal_id !== line.confirmed_item_id);
                      const searching = searchQuery.trim().length >= 2;
                      const last = idx === lines.length - 1;
                      return (
                        <li key={line.line_no}>
                          <button type="button" data-line-row onClick={() => (open ? setSearchIdx(null) : openLine(idx))} aria-current={on || undefined} aria-expanded={open}
                            className={cn("group grid w-full grid-cols-[24px_minmax(0,1fr)_auto_auto] items-center gap-2.5 rounded-[10px] border px-3 py-2.5 text-left text-[13.5px]",
                              on ? "border-[#EBD9AE] bg-[#FFFBF2]" : "border-transparent hover:bg-secondary/40")}>
                            <LineNo n={line.line_no} warn={!hasItem} />
                            <span className="min-w-0">
                              <span className={cn("block truncate", on && "font-semibold")}>{line.description || "Línea sin descripción"}</span>
                              <small className={cn("block truncate text-[12.5px]", hasItem ? "text-muted-foreground" : "text-tone-warn")}>
                                {hasItem ? [code ?? getDisplayName(line), unit].filter(Boolean).join(" · ") : "Sin ítem del ERP"}
                              </small>
                            </span>
                            <span className={cn("text-[12.5px] font-semibold text-link", !on && "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100")}>{hasItem ? "Cambiar ítem" : "Elegir ítem"}</span>
                            <span className="tabular-nums text-muted-foreground">{line.amount !== null ? `$${fmt(line.amount)}` : "—"}</span>
                          </button>

                          {/* The item window opens under its line, so the document stays in view. */}
                          {open && (
                            <div ref={itemWindowRef} role="dialog" aria-label={`Ítem de la línea ${line.line_no}`}
                              className="absolute inset-x-0 z-20 mt-2 flex max-w-[640px] scroll-mb-4 flex-col rounded-[14px] border border-[#D6D2C8] bg-card shadow-[0_18px_50px_rgba(30,32,41,0.22),0_2px_8px_rgba(30,32,41,0.08)]">
                              <span aria-hidden className="absolute -top-[7px] left-[17px] size-3 rotate-45 border-l border-t border-[#D6D2C8] bg-card" />
                              <div className="flex items-start justify-between gap-3.5 border-b border-line-soft px-4.5 pb-3 pt-4">
                                <div className="min-w-0">
                                  <span className="block text-[11.5px] font-semibold uppercase tracking-[0.05em] text-foreground/75">Línea {line.line_no} de {lines.length}</span>
                                  <b className="mt-0.5 block truncate text-base font-semibold tracking-[-0.01em]">{line.description || "Línea sin descripción"}</b>
                                  {!line.manual && (
                                    <span className="block truncate text-[12.5px] text-muted-foreground">
                                      En el documento: {[line.item_code, `${line.quantity} × ${line.rate !== null ? `$${fmt(line.rate)}` : "sin precio"}`, line.uom].filter(Boolean).join(" · ")}
                                    </span>
                                  )}
                                </div>
                                <button type="button" onClick={() => setSearchIdx(null)} aria-label="Cerrar" className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-foreground/70 hover:text-foreground"><X className="size-4" /></button>
                              </div>

                              <div className="flex flex-col gap-3 px-4.5 py-3.5">
                                <label className="relative block">
                                  <span className="sr-only">Buscar en el catálogo del ERP</span>
                                  <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                                  <input ref={searchInputRef} type="search" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="Buscar en el catálogo del ERP: nombre o código"
                                    className="min-h-10 w-full rounded-lg border border-[#D6D2C8] bg-white pl-9 pr-9 text-[13.5px] outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
                                  {searchLoading && <Loader2 aria-hidden className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
                                </label>

                                {searching ? (
                                  searchLoading && searchResults.length === 0 ? (
                                    <p className="text-[13px] text-muted-foreground">Buscando…</p>
                                  ) : searchResults.length === 0 ? (
                                    <p className="text-[13px] text-muted-foreground">Sin resultados para «{searchQuery.trim()}». Prueba con otro nombre o con el código.</p>
                                  ) : (
                                    <div role="radiogroup" aria-label="Resultados del catálogo" className="flex max-h-60 flex-col gap-1.5 overflow-y-auto pr-0.5">
                                      {searchResults.map((item) => (
                                        <ItemOptionRow key={item.internalId} name={`item-${line.line_no}`} checked={item.internalId === line.confirmed_item_id}
                                          title={[item.itemid && item.itemid !== item.name ? item.itemid : null, item.name || item.itemid].filter(Boolean).join(" · ")}
                                          sub={item.unit ? `Unidad ${item.unit}` : null} tag="Del catálogo"
                                          onPick={() => selectFromSearch(idx, item)} />
                                      ))}
                                    </div>
                                  )
                                ) : (
                                  <div role="radiogroup" aria-label="Ítem del ERP" className="flex flex-col gap-1.5">
                                    {hasItem && (
                                      <ItemOptionRow name={`item-${line.line_no}`} checked
                                        title={[code !== getDisplayName(line) ? code : null, getDisplayName(line)].filter(Boolean).join(" · ")}
                                        sub={[line.recommendation_source === "memory" && candidate ? "Aprendido de facturas anteriores" : candidate ? "Sugerido" : "Elegido del catálogo", unit ? `unidad ${unit}` : null].filter(Boolean).join(" · ")}
                                        tag="Asignado ahora" onPick={() => {}} />
                                    )}
                                    {others.slice(0, 4).map((c, i) => (
                                      <ItemOptionRow key={c.internal_id} name={`item-${line.line_no}`} checked={false}
                                        title={[c.itemid && c.itemid !== c.name ? c.itemid : null, c.name || c.itemid].filter(Boolean).join(" · ")}
                                        sub={c.unit ? `Unidad ${c.unit}` : null}
                                        tag={c.memory_source ? "Aprendido" : !hasItem && i === 0 ? "Sugerido" : "Otra opción"} accent={c.memory_source || (!hasItem && i === 0)}
                                        onPick={() => selectFromCandidate(idx, c.internal_id)} />
                                    ))}
                                    {!hasItem && others.length === 0 && <p className="text-[13px] text-muted-foreground">Sin coincidencias en el catálogo del ERP. Búscalo arriba por nombre o código.</p>}
                                  </div>
                                )}

                                {line.manual && (
                                  <label className="flex flex-col gap-1 text-[12.5px] text-foreground/75">Descripción
                                    <input type="text" value={line.description} onChange={(e) => editLine(idx, { description: e.target.value })} className={lineInput} />
                                  </label>
                                )}
                                <div className="grid grid-cols-[minmax(0,1fr)_88px_112px] gap-2.5 text-[12.5px] text-foreground/75">
                                  <div className="flex min-w-0 flex-col gap-1">
                                    <span id={`unit-${line.line_no}`}>Unidad</span>
                                    {candidate && candidate.unit_ids.length > 1 ? (
                                      <SelectMenu value={line.confirmed_unit_id ?? ""} onChange={(v) => setLineUnit(idx, v)} ariaLabel="Unidad de medida"
                                        options={candidate.unit_ids.map((uid, i) => ({ value: uid, label: candidate.unit_names[i] || uid }))} />
                                    ) : (
                                      <span aria-labelledby={`unit-${line.line_no}`} className="flex min-h-9 items-center truncate rounded-lg border border-line-soft bg-secondary/40 px-2.5 text-[13.5px] text-foreground">{unit ?? "—"}</span>
                                    )}
                                  </div>
                                  <label className="flex flex-col gap-1">Cantidad
                                    <input type="number" min="0" step="any" value={line.quantity} onChange={(e) => editLine(idx, { quantity: e.target.value === "" ? 0 : Number(e.target.value) })} className={cn(lineInput, "tabular-nums")} />
                                  </label>
                                  <label className="flex flex-col gap-1">Precio unitario
                                    <input type="number" min="0" step="any" value={line.rate ?? ""} onChange={(e) => editLine(idx, { rate: e.target.value === "" ? null : Number(e.target.value) })} className={cn(lineInput, "tabular-nums")} />
                                  </label>
                                </div>
                              </div>

                              <div className="flex flex-wrap items-center gap-2 border-t border-line-soft px-4.5 py-3">
                                <button type="button" onClick={() => deleteLine(idx)} className={btn("text", "sm", "px-0 text-tone-err")}><Trash2 />Quitar línea</button>
                                <span className="ml-auto flex flex-wrap gap-2">
                                  <button type="button" disabled={idx === 0} onClick={() => openLine(idx - 1)} className={btn("secondary", "sm")}>Línea anterior</button>
                                  <button type="button" onClick={() => (last ? setSearchIdx(null) : openLine(idx + 1))} className={btn("primary", "sm")}>
                                    {last ? "Listo" : `Guardar y seguir con la ${line.line_no + 1}`}
                                  </button>
                                </span>
                              </div>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  <button type="button" onClick={addLine} className={btn("text", "sm", "mt-1 px-3 text-link")}><Plus />Agregar línea</button>
                </section>

                <p className="flex flex-wrap justify-between gap-2 border-t border-border pt-2.5 text-[13.5px] tabular-nums">
                  <span>Total ${fmt(Number(doc.totals.total))} {doc.currency}</span>
                  {balance === null ? null : balance.ok
                    ? <span className="font-semibold text-tone-ok">✓ Las líneas cuadran con el documento</span>
                    : <span className="font-semibold text-tone-warn">Las líneas suman ${fmt(balance.sum)}; el subtotal es ${fmt(balance.expected)}</span>}
                </p>
                {unpricedCount > 0 && (
                  <p className="text-[12.5px] text-tone-warn">{unpricedCount} línea{unpricedCount === 1 ? "" : "s"} sin precio: captúralo para poder enviar.</p>
                )}
                {missingCount > 0 && (
                  <p className="text-[12.5px] text-tone-warn">{missingCount} línea{missingCount === 1 ? "" : "s"} sin ítem se omitirá{missingCount === 1 ? "" : "n"} al enviar. Asígnales un ítem o quítalas.</p>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-4.5 min-h-0 flex-1 overflow-y-auto border-t border-border">
            <div className="mx-auto flex w-full max-w-[980px] flex-col gap-4 px-6 py-5.5 md:px-8">
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
                  : <FiscalEmpty isCfdi={isCfdi} pending />
              )}

              {tab === "erp" && (
                <div className="mx-auto flex w-full max-w-[860px] flex-col gap-4.5">
                  <section aria-labelledby="bill-h" className="overflow-hidden rounded-xl border border-border bg-white">
                    <div className="flex flex-wrap items-baseline justify-between gap-4 border-b border-foreground px-5.5 pb-3.5 pt-4.5">
                      <h2 id="bill-h" className="text-lg font-semibold tracking-[-0.015em]">Factura de proveedor que se va a crear</h2>
                      {subsidiaryName && <span className="text-[12.5px] text-muted-foreground">En el ERP de {subsidiaryName}</span>}
                    </div>
                    <dl className="grid grid-cols-[repeat(auto-fit,minmax(min(150px,100%),1fr))] gap-x-5.5 gap-y-3.5 border-b border-line-soft px-5.5 py-4">
                      <div>
                        <dt className={erpFactLabel}>Proveedor</dt>
                        <dd className={cn(erpFactValue, !vendorName && "text-tone-warn")}>{vendorName || "Sin elegir"}</dd>
                      </div>
                      <div>
                        <dt className={erpFactLabel}>Número y fecha</dt>
                        <dd className={cn(erpFactValue, "tabular-nums")}>{doc.invoice_number ?? "Sin número"}{doc.invoice_date && <small className={erpFactNote}>{doc.invoice_date}</small>}</dd>
                      </div>
                      <div>
                        <dt className={erpFactLabel}>Ubicación</dt>
                        <dd className={cn(erpFactValue, !erpLocation && "text-tone-warn")}>
                          {erpLocation ?? "Sin ubicación"}
                          {!erpLocation && <small className={erpFactNote}><button type="button" onClick={() => selectTab("lines")} className="text-link hover:underline">Elegir en Datos y líneas</button></small>}
                        </dd>
                      </div>
                      {poEnabled && (
                        <div>
                          <dt className={erpFactLabel}>Orden de compra</dt>
                          <dd className={erpFactValue}>
                            {erpPo ?? "Sin OC"}
                            <small className={erpFactNote}>{!erpPo && "Factura independiente · "}<button type="button" onClick={() => selectTab("po")} className="text-link hover:underline">{erpPo ? "Cambiar" : "Elegir una OC"}</button></small>
                          </dd>
                        </div>
                      )}
                    </dl>
                    {/* Las líneas se desplazan dentro de la tarjeta: con 50 el total sigue a la vista. */}
                    <div className="max-h-[372px] overflow-auto">
                      <table className="w-full border-collapse text-[13.5px]">
                        <thead>
                          <tr>
                            {(["#", "Ítem del ERP", "Unidad", "Cant.", "Precio", "Importe"] as const).map((h, i) => (
                              <th key={h} scope="col" className={cn("sticky top-0 whitespace-nowrap bg-white px-3 py-2.5 text-[11.5px] font-semibold uppercase tracking-[0.05em] text-foreground/75 shadow-[inset_0_-1px_0_#E2DFD8] first:pl-5.5 last:pr-5.5", i > 2 ? "text-right" : "text-left")}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {lines.map((line) => {
                            const has = Boolean(line.confirmed_item_id);
                            return (
                              <tr key={line.line_no} className="border-b border-line-soft last:border-0 [&>td]:px-3 [&>td]:py-[9px] [&>td]:align-top [&>td:first-child]:pl-5.5 [&>td:last-child]:pr-5.5">
                                <td className="tabular-nums text-muted-foreground">{line.line_no}</td>
                                <td>
                                  {has ? (getDisplayCode(line) ?? getDisplayName(line)) : <span className="font-semibold text-tone-warn">Sin ítem · se omite al enviar</span>}
                                  <small className="block text-[12.5px] text-muted-foreground">{line.description || "Línea sin descripción"}</small>
                                </td>
                                <td>{(has && unitName(line)) || "—"}</td>
                                <td className="whitespace-nowrap text-right tabular-nums">{line.quantity}</td>
                                <td className="whitespace-nowrap text-right tabular-nums">{line.rate !== null ? `$${fmt(line.rate)}` : "—"}</td>
                                <td className="whitespace-nowrap text-right tabular-nums">{line.amount !== null ? `$${fmt(line.amount)}` : "—"}</td>
                              </tr>
                            );
                          })}
                          {lines.length === 0 && <tr><td colSpan={6} className="px-5.5 py-4 text-muted-foreground">La factura no tiene líneas.</td></tr>}
                        </tbody>
                      </table>
                    </div>
                    <div className="flex flex-wrap items-baseline justify-between gap-4 border-t border-border px-5.5 pb-3.5 pt-3 text-sm font-semibold">
                      <span className="text-[12.5px] font-normal text-muted-foreground">
                        {assignedCount} línea{assignedCount === 1 ? "" : "s"}
                        {balance?.ok && ", cuadran con el total del documento"}
                        {balance && !balance.ok && <span className="font-semibold text-tone-warn"> · suman ${fmt(balance.sum)}; el subtotal es ${fmt(balance.expected)}</span>}
                        {missingCount > 0 && <span className="font-semibold text-tone-warn"> · {missingCount} sin ítem se omite{missingCount === 1 ? "" : "n"}</span>}
                        {lines.length > 6 && " · desplázate en la tabla para verlas todas"}
                      </span>
                      <span className="tabular-nums">Total ${fmt(Number(doc.totals.total))} {doc.currency}</span>
                    </div>
                  </section>
                  {sandboxTest && (
                    <SandboxTestSend docId={docId} history={testSends} disabled={submitting} buildBody={() => (vendorId && validLines.length ? reviewBody() : null)} />
                  )}
                </div>
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
          <p className="min-w-[240px] flex-1 text-[13.5px]">{!canWrite ? "Tu rol es de solo consulta: puedes ver el documento, no enviarlo." : submitError ? <span className="text-tone-err">{submitError}</span> : action.message}</p>
          {sandboxTest && tab !== "erp" && (
            <SandboxTestSend docId={docId} compact history={testSends} disabled={submitting} buildBody={() => (vendorId && validLines.length ? reviewBody() : null)} />
          )}
          {action.secondary && (
            <button type="button" onClick={action.secondary.run} disabled={submitting || !vendorId || !canWrite} className={btn("secondary")}>{action.secondary.label}</button>
          )}
          <button type="button" onClick={action.primary.run} disabled={submitting || !vendorId || action.primary.disabled || !canWrite} className={btn("primary")}>
            {submitting && <Loader2 className="animate-spin" />}
            {submitting ? "Enviando…" : action.primary.label}
          </button>
        </div>
      </div>
    </>
  );
}

const erpFactLabel = "text-[11.5px] font-semibold uppercase tracking-[0.05em] text-foreground/75";
const erpFactValue = "mt-[3px] text-sm font-semibold";
const erpFactNote = "block text-[12.5px] font-normal text-muted-foreground";

/** One choice in the item window: a radio row with the item, its unit and where it comes from. */
function ItemOptionRow({ name, checked, title, sub, tag, accent = false, onPick }: {
  name: string; checked: boolean; title: string; sub: string | null; tag: string; accent?: boolean; onPick: () => void;
}) {
  return (
    <label className={cn("grid cursor-pointer grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-[10px] border bg-white px-3 py-2 text-[13.5px]",
      checked ? "border-primary shadow-[0_0_0_3px_rgba(14,124,112,0.1)]" : "border-border hover:border-foreground/30")}>
      <input type="radio" name={name} checked={checked} onChange={onPick} className="size-4 accent-primary" />
      <span className="min-w-0">
        <b className="block truncate font-semibold">{title}</b>
        {sub && <small className="block truncate text-[12.5px] text-muted-foreground first-letter:uppercase">{sub}</small>}
      </span>
      <span className={cn("whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11.5px] font-semibold", accent ? "bg-tone-info-bg text-tone-info" : "bg-tone-mute-bg text-foreground/75")}>{tag}</span>
    </label>
  );
}

function LineNo({ n, warn }: { n: number; warn: boolean }) {
  return (
    <span className={cn("inline-flex size-[18px] items-center justify-center rounded-full text-[10px] font-bold text-white", warn ? "bg-[#B07C0E]" : "bg-primary")}>
      {n}<span className="sr-only">{warn ? ", sin ítem" : ""}</span>
    </span>
  );
}
