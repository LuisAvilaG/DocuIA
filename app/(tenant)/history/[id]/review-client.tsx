"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  CheckCircle2, AlertTriangle, Loader2, ChevronLeft,
  Building2, FileText, Package, MapPin, Sparkles,
  ChevronDown, ChevronUp, Search, X, Eye, EyeOff,
  Trash2, Plus, ExternalLink, XCircle,
} from "lucide-react";
import type { BBox } from "@/lib/workflow/types";
import { DocPreview } from "./doc-preview-lazy";

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
  payload,
}: {
  docId: number;
  subsidiaryId: string;
  storageKey: string | null;
  fileExt: string;
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
  const [previewWidth, setPreviewWidth] = useState(720);
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
      const delta = dragStartX.current - e.clientX;
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

  // Focus + prefill when vendor search opens
  useEffect(() => {
    if (vendorSearchOpen) {
      setVendorQuery(doc.vendor.name ?? "");
      setVendorResults([]);
      setTimeout(() => vendorSearchInputRef.current?.focus(), 60);
    }
  }, [vendorSearchOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced vendor search
  useEffect(() => {
    if (!vendorSearchOpen || vendorQuery.length < 1) {
      setVendorResults([]);
      setVendorSearchLoading(false);
      return;
    }
    setVendorSearchLoading(true);
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
    setVendorSearchOpen(false);
    setVendorCandidatesOpen(false);
  }

  // Focus + prefill when search dialog opens
  useEffect(() => {
    if (searchIdx !== null) {
      const prefill = lines[searchIdx]?.description ?? "";
      setSearchQuery(prefill);
      setSearchResults([]);
      setTimeout(() => searchInputRef.current?.focus(), 60);
    }
  }, [searchIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced catalog search
  useEffect(() => {
    if (searchIdx === null || !searchQuery.trim() || searchQuery.length < 2) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
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

  // ── Submit ────────────────────────────────────────────────────────────────

  async function handleApprove() {
    setSubmitError("");
    if (!vendorId) { setSubmitError("Selecciona un proveedor de NetSuite antes de aprobar."); return; }
    const validLines = lines.filter(l => l.confirmed_item_id);
    if (!validLines.length) { setSubmitError("Asigna al menos un ítem de NetSuite para poder aprobar."); return; }
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
          line_items: validLines.map(l => ({
            internal_id:        l.confirmed_item_id,
            item_document_name: l.description,
            quantity:           l.quantity,
            rate:               l.rate,
            amount:             l.amount,
            unit:               l.confirmed_unit_id,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setSubmitError(data.error ?? "Error al procesar en NetSuite"); return; }
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
                <p className="text-sm font-semibold text-foreground">Documento enviado a NetSuite</p>
                <p className="text-xs text-muted-foreground mt-0.5">La transacción fue creada exitosamente</p>
              </div>
            </div>

            {/* Details */}
            <div className="px-5 py-4 space-y-3">
              {submitResult.netsuiteId && (
                <div className="flex items-center justify-between gap-3 py-2 border-b border-border/60">
                  <span className="text-xs text-muted-foreground">ID NetSuite</span>
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
                  Ver en NetSuite
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
                  <p className="text-sm text-muted-foreground">Sin resultados para "{vendorQuery}"</p>
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
                  <p className="text-sm text-muted-foreground">Sin resultados para "{searchQuery}"</p>
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
            className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <div className="flex-1 flex items-center gap-2.5">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center border shrink-0"
              style={{ backgroundColor: "oklch(0.96 0.04 85)", borderColor: "oklch(0.62 0.16 85 / 0.25)" }}
            >
              <FileText className="w-3.5 h-3.5" style={{ color: "oklch(0.58 0.16 85)" }} />
            </div>
            <div>
              <h1 className="text-sm font-semibold text-foreground leading-tight">Revisión de extracción</h1>
              <p className="text-[11px] text-muted-foreground">
                Documento #{docId} · Verifica antes de enviar a NetSuite
              </p>
            </div>
          </div>

          {/* Confidence badge */}
          <div
            className={cn(
              "flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border shrink-0",
              overallPct >= 80
                ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                : overallPct >= 60
                ? "border-amber-400/25"
                : "bg-red-500/10 text-red-600 border-red-500/20"
            )}
            style={overallPct >= 60 && overallPct < 80
              ? { backgroundColor: "oklch(0.96 0.04 85)", color: "oklch(0.50 0.14 80)", borderColor: "oklch(0.62 0.16 85 / 0.25)" }
              : undefined}
          >
            <Sparkles className="w-3 h-3" />
            {overallPct}% confianza
          </div>

          {/* Document preview toggle — always visible */}
          <button
            onClick={() => storageKey ? setPreviewOpen(p => !p) : undefined}
            disabled={!storageKey}
            title={!storageKey ? "El archivo no fue guardado. Activa la función de almacenamiento de documentos." : undefined}
            className={cn(
              "flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-all",
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

          {/* ── Left sidebar ─────────────────────────────────────────────── */}
          <aside
            className="shrink-0 border-r border-border bg-card overflow-y-auto flex flex-col transition-all"
            style={{ width: previewOpen ? "220px" : "272px" }}
          >
            <div className="flex-1 p-4 space-y-4">

              {/* Vendor */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground flex items-center gap-1.5 mb-2">
                  <Building2 className="w-3 h-3" />
                  Proveedor
                </p>

                {/* Selected vendor chip */}
                <div className="relative mb-1.5">
                  {vendorId ? (
                    <div
                      className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs"
                      style={{ backgroundColor: "oklch(0.97 0.02 182)", borderColor: "oklch(0.48 0.15 182 / 0.25)" }}
                    >
                      <CheckCircle2 className="w-3 h-3 text-primary shrink-0" />
                      <div className="flex-1 min-w-0">
                        <span className="font-semibold text-foreground block truncate leading-tight">{vendorName || vendorId}</span>
                      </div>
                      {/* Other candidates button */}
                      {doc.vendor.options.filter(v => v.internal_id !== vendorId).length > 0 && (
                        <button
                          onClick={() => setVendorCandidatesOpen(o => !o)}
                          className="flex items-center gap-0.5 text-[11px] font-semibold text-primary hover:text-primary/75 transition-colors shrink-0"
                        >
                          {vendorCandidatesOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          {doc.vendor.options.filter(v => v.internal_id !== vendorId).length}
                        </button>
                      )}
                    </div>
                  ) : (
                    <div
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-dashed text-xs"
                      style={{ borderColor: "oklch(0.62 0.16 85 / 0.4)", backgroundColor: "oklch(0.97 0.015 85 / 0.6)" }}
                    >
                      <AlertTriangle className="w-3 h-3 shrink-0" style={{ color: "oklch(0.58 0.16 85)" }} />
                      <span className="text-muted-foreground">Sin proveedor seleccionado</span>
                    </div>
                  )}

                  {/* Candidates dropdown */}
                  {vendorCandidatesOpen && doc.vendor.options.filter(v => v.internal_id !== vendorId).length > 0 && (
                    <div
                      className="absolute top-full left-0 right-0 mt-1 z-30 bg-card border border-border rounded-xl overflow-hidden"
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
                            {v.entityid && v.entityid !== v.name && (
                              <p className="text-[10px] font-mono text-muted-foreground">{v.entityid}</p>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Vendor search button — always visible */}
                <button
                  onClick={() => setVendorSearchOpen(true)}
                  className="w-full flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-secondary hover:border-border/80 transition-all"
                >
                  <Search className="w-3 h-3" />
                  Buscar proveedor
                </button>
              </div>

              <div className="h-px bg-border" />

              {/* Document header */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground flex items-center gap-1.5 mb-2.5">
                  <FileText className="w-3 h-3" />
                  Encabezado
                </p>
                <div className="space-y-1.5">
                  {[
                    { label: "Núm. doc.", value: doc.invoice_number },
                    { label: "Fecha",     value: doc.invoice_date },
                    { label: "Vence",     value: doc.due_date },
                    { label: "Moneda",    value: doc.currency },
                  ].filter(r => r.value).map(({ label, value }) => (
                    <div key={label} className="flex items-baseline justify-between gap-2">
                      <span className="text-[11px] text-muted-foreground shrink-0">{label}</span>
                      <span className="text-[11px] font-medium text-foreground truncate text-right">{value}</span>
                    </div>
                  ))}

                  <div className="h-px bg-border/60 my-1" />

                  {doc.totals.subtotal && (
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[11px] text-muted-foreground">Subtotal</span>
                      <span className="text-[11px] text-foreground tabular-nums">${fmt(Number(doc.totals.subtotal))}</span>
                    </div>
                  )}
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[11px] text-muted-foreground">IVA</span>
                    <span className="text-[11px] text-foreground tabular-nums">${fmt(Number(doc.totals.tax))}</span>
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[11px] font-semibold text-foreground">Total</span>
                    <span className="text-sm font-semibold text-foreground tabular-nums">${fmt(Number(doc.totals.total))}</span>
                  </div>
                </div>
              </div>

              {/* Location */}
              {payload.catalogs.locations.length > 0 && (
                <>
                  <div className="h-px bg-border" />
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground flex items-center gap-1.5 mb-2">
                      <MapPin className="w-3 h-3" />
                      Ubicación
                      <span className="normal-case font-normal text-muted-foreground/50">(opcional)</span>
                    </p>
                    <select
                      value={locationId}
                      onChange={e => setLocationId(e.target.value)}
                      className="w-full bg-background border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-[border-color,box-shadow]"
                    >
                      <option value="">— Sin ubicación —</option>
                      {payload.catalogs.locations.map(loc => (
                        <option key={loc.internal_id} value={loc.internal_id}>{loc.name}</option>
                      ))}
                    </select>
                  </div>
                </>
              )}
            </div>
          </aside>

          {/* ── Lines panel ──────────────────────────────────────────────── */}
          <div
            className="flex-1 flex flex-col overflow-hidden"
          >
            {/* Action bar */}
            <div className="border-b border-border px-5 py-2.5 flex items-center justify-between shrink-0 bg-background/90 backdrop-blur-sm">
              <div className="flex items-center gap-3 text-xs">
                <span className="text-muted-foreground">
                  <span className="font-medium text-foreground">{lines.length}</span> línea{lines.length !== 1 ? "s" : ""}
                </span>
                <span className="flex items-center gap-1 font-medium text-emerald-600">
                  <CheckCircle2 className="w-3 h-3" />
                  {assignedCount} asignada{assignedCount !== 1 ? "s" : ""}
                </span>
                {missingCount > 0 && (
                  <span className="flex items-center gap-1 font-medium" style={{ color: "oklch(0.50 0.14 80)" }}>
                    <AlertTriangle className="w-3 h-3" />
                    {missingCount} sin ítem
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2.5">
                <button
                  onClick={() => router.back()}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleApprove}
                  disabled={submitting || !vendorId}
                  className="flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  {submitting
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <CheckCircle2 className="w-3.5 h-3.5" />
                  }
                  {submitting ? "Enviando…" : missingCount > 0 ? `Aprobar (${missingCount} sin ítem)` : "Aprobar y enviar"}
                </button>
              </div>
            </div>

            {/* Column header */}
            <div className="sticky top-0 z-10 px-5 py-1.5 border-b border-border/60 bg-background/80 backdrop-blur-sm shrink-0">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground flex items-center gap-1.5">
                <Package className="w-3 h-3" />
                Líneas del documento
              </span>
            </div>

            {/* Lines list */}
            <div className="flex-1 overflow-y-auto divide-y divide-border/60">
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
                        <select
                          value={line.confirmed_unit_id ?? ""}
                          onChange={e => setLineUnit(idx, e.target.value)}
                          className="shrink-0 bg-background border border-border rounded-lg px-2 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary transition-[border-color]"
                        >
                          {candidateItem.unit_ids.map((uid, i) => (
                            <option key={uid} value={uid}>{candidateItem.unit_names[i] || uid}</option>
                          ))}
                        </select>
                      )}

                      {/* Catalog unit display */}
                      {fromSearch && line.catalog_unit_name && (
                        <div className="shrink-0 px-2 py-1.5 bg-secondary/50 border border-border rounded-lg text-xs text-foreground">
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

              {/* Submit error */}
              {submitError && (
                <div
                  className="mx-5 mt-3 flex items-start gap-2 px-3.5 py-2.5 rounded-xl border text-xs"
                  style={{
                    backgroundColor: "oklch(0.96 0.04 25)",
                    borderColor:     "oklch(0.50 0.20 25 / 0.2)",
                    color:           "oklch(0.50 0.20 25)",
                  }}
                >
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  {submitError}
                </div>
              )}

              {missingCount > 0 && !submitError && (
                <div
                  className="mx-5 mt-3 mb-3 flex items-start gap-2.5 px-3.5 py-2.5 rounded-xl border"
                  style={{
                    backgroundColor: "oklch(0.97 0.06 85 / 0.6)",
                    borderColor:     "oklch(0.62 0.16 85 / 0.35)",
                    color:           "oklch(0.45 0.14 85)",
                  }}
                >
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span className="text-xs font-medium">
                    {missingCount} línea{missingCount !== 1 ? "s" : ""} sin ítem asignado — se omitirán al enviar a NetSuite. Asigna los ítems o elimina esas líneas antes de aprobar.
                  </span>
                </div>
              )}

              <div className="h-6" />
            </div>
          </div>

          {/* ── Drag handle ──────────────────────────────────────────────── */}
          {previewOpen && storageKey && (
            <div
              onMouseDown={handleDragStart}
              className="shrink-0 w-1 bg-border hover:bg-primary/40 cursor-col-resize transition-colors active:bg-primary/60"
              style={{ touchAction: "none" }}
            />
          )}

          {/* ── Document preview panel ────────────────────────────────────── */}
          {previewOpen && storageKey && (
            <div
              className="shrink-0 flex flex-col overflow-hidden"
              style={{ width: previewWidth }}
            >
              <DocPreview
                docId={docId}
                activeBbox={activeBbox}
                fileExt={fileExt}
              />
            </div>
          )}
        </div>
      </div>
    </>
  );
}
