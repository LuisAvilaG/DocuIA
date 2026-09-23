"use client";

// Shared AP panels for the document screens: fiscal (SAT) validation, the
// purchase-order picker and the invoice ↔ PO comparison.

import { useMemo, useState } from "react";
import { CheckCircle2, XCircle, CircleHelp, Search, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FiscalValidation } from "@/lib/cfdi/validation";
import type { LineComparison, PoComparison, PoOutcome, PoSuggestion } from "@/lib/workflow/po-match";
import type { NSOpenPurchaseOrder } from "@/lib/netsuite/client";

export type Tone = "ok" | "warn" | "err" | "info" | "grey";

export function Badge({ tone, children, className }: { tone: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[0.6875rem] font-semibold whitespace-nowrap",
      tone === "ok" && "bg-success/10 text-success",
      tone === "warn" && "bg-warning/10 text-warning",
      tone === "err" && "bg-destructive/10 text-destructive",
      tone === "info" && "bg-primary/10 text-primary",
      tone === "grey" && "bg-secondary text-muted-foreground",
      className,
    )}>{children}</span>
  );
}

export function money(n: number | null | undefined, digits = 2) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString("es-MX", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${money(Math.abs(n))}`;
const signedPct = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toLocaleString("es-MX", { maximumFractionDigits: 2 })}%`;

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section className={cn("bg-card border border-border rounded-xl", className)}>{children}</section>;
}

// ── Fiscal validation ─────────────────────────────────────────────────────────

export function FiscalPanel({ fiscal }: { fiscal: FiscalValidation }) {
  const tone: Tone = fiscal.outcome === "ok" ? "ok" : fiscal.outcome === "blocked" ? "err" : "warn";
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2.5 mb-3">
        <h2 className="text-sm font-semibold text-foreground">Validación fiscal del CFDI</h2>
        <Badge tone={tone}>{fiscal.outcome === "ok" ? "Válido" : fiscal.outcome === "blocked" ? "Bloqueado" : "Revisar"}</Badge>
        <span className="ml-auto text-[0.6875rem] text-muted-foreground">
          Consultado {new Date(fiscal.checkedAt).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {fiscal.checks.map((check) => (
          <li key={check.key} className="flex items-start gap-2 text-xs">
            {check.ok === true
              ? <CheckCircle2 className="w-3.5 h-3.5 mt-px shrink-0 text-success" aria-label="Correcto" />
              : check.ok === false
              ? <XCircle className="w-3.5 h-3.5 mt-px shrink-0 text-destructive" aria-label="Con problema" />
              : <CircleHelp className="w-3.5 h-3.5 mt-px shrink-0 text-muted-foreground" aria-label="Sin verificar" />}
            <span><span className="font-medium text-foreground">{check.label}</span>{check.detail && <span className="block text-muted-foreground">{check.detail}</span>}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ── Purchase-order picker ─────────────────────────────────────────────────────

function reasonText(s: PoSuggestion, tolerance: string | null) {
  return s.reason === "number" ? "Coincide el número de OC de la factura" : `Total similar${tolerance ? ` (dentro de la tolerancia de ${tolerance})` : ""}`;
}

function DiffBadge({ difference, pct, ok }: { difference: number; pct: number; ok: boolean }) {
  return <Badge tone={ok ? "ok" : "warn"} className="justify-center tabular-nums">{signed(difference)} · {signedPct(pct)}</Badge>;
}

export function PoPicker({
  requirement, vendorName, openPOs, suggestions, selectedId, onSelect, loading, error, invoiceTotal, toleranceLabel, disabled,
}: {
  requirement: "required" | "optional" | "none" | null;
  vendorName: string;
  openPOs: NSOpenPurchaseOrder[];
  suggestions: PoSuggestion[];
  selectedId: string;
  onSelect: (id: string) => void;
  loading: boolean;
  error: string | null;
  invoiceTotal: number;
  toleranceLabel: string | null;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const suggestedIds = new Set(suggestions.map((s) => s.internalId));

  const listed = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q && !showAll) return [];
    return openPOs
      .filter((po) => !suggestedIds.has(po.internal_id))
      .filter((po) => !q || [po.tranid, po.date, po.total, po.internal_id].some((v) => String(v ?? "").toLowerCase().includes(q)))
      .slice(0, 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openPOs, query, showAll, suggestions]);

  // A PO chosen from the full list stays visible after the search is cleared.
  const selectedExtra = selectedId && !suggestedIds.has(selectedId) && !listed.some((p) => p.internal_id === selectedId)
    ? openPOs.find((p) => p.internal_id === selectedId) ?? null
    : null;

  const row = (id: string, title: string, subtitle: string, total: number, badge: React.ReactNode) => (
    <button
      key={id}
      type="button"
      disabled={disabled}
      onClick={() => onSelect(selectedId === id ? "" : id)}
      aria-pressed={selectedId === id}
      className={cn(
        "w-full flex items-center gap-3 rounded-lg border px-3.5 py-2.5 text-left transition-colors duration-[120ms] disabled:opacity-60",
        selectedId === id ? "border-primary/50 bg-primary/5" : "border-border hover:bg-secondary/50",
      )}
    >
      <span className={cn("w-3.5 h-3.5 rounded-full border-2 shrink-0", selectedId === id ? "border-primary bg-primary shadow-[inset_0_0_0_2px_var(--card)]" : "border-border")} />
      <span className="flex-1 min-w-0">
        <span className="block text-[0.8125rem] font-semibold text-foreground truncate">{title}</span>
        <span className="block text-xs text-muted-foreground truncate">{subtitle}</span>
      </span>
      <span className="w-28 text-right text-[0.8125rem] tabular-nums text-foreground">${money(total)}</span>
      <span className="w-32 flex justify-end">{badge}</span>
    </button>
  );

  const poRow = (po: NSOpenPurchaseOrder) => {
    const total = Number(po.total) || 0;
    const diff = Math.round((invoiceTotal - total) * 100) / 100;
    const pct = total ? Math.round((diff / total) * 10000) / 100 : 0;
    return row(po.internal_id, `${po.tranid || `OC #${po.internal_id}`}${po.date ? ` · ${po.date}` : ""}`, po.status || "Abierta", total,
      <DiffBadge difference={diff} pct={pct} ok={Math.abs(diff) < 0.005} />);
  };

  return (
    <Card className="p-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2.5">
        <h2 className="text-sm font-semibold text-foreground">Orden de compra</h2>
        {requirement === "required" && <Badge tone="err">Obligatoria para este proveedor</Badge>}
        {requirement === "none" && <Badge tone="grey">Este proveedor se factura sin OC</Badge>}
        <span className="ml-auto text-xs text-muted-foreground">
          {loading ? <span className="inline-flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" />Consultando el ERP…</span>
            : `${openPOs.length} OC abierta${openPOs.length === 1 ? "" : "s"}${vendorName ? ` de ${vendorName}` : ""}`}
        </span>
      </div>

      {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}

      {requirement !== "none" && (
        <div className="flex flex-col gap-2">
          {suggestions.map((s) => row(
            s.internalId,
            `${s.tranid || `OC #${s.internalId}`}${s.date ? ` · ${s.date}` : ""}`,
            reasonText(s, toleranceLabel),
            s.total,
            <DiffBadge difference={s.difference} pct={s.differencePct} ok={s.withinTolerance} />,
          ))}
          {selectedExtra && poRow(selectedExtra)}
          {listed.map(poRow)}
          {!loading && !error && openPOs.length === 0 && (
            <p className="text-xs text-muted-foreground">El proveedor no tiene órdenes de compra abiertas en esta subsidiaria.</p>
          )}
          {!loading && openPOs.length > 0 && suggestions.length === 0 && !query && !showAll && !selectedExtra && (
            <p className="text-xs text-muted-foreground">Ninguna OC coincide por número o total. Búscala entre las abiertas del proveedor.</p>
          )}
          {openPOs.length > 0 && (
            <div className="flex items-center gap-2.5">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="Buscar orden de compra"
                  placeholder="Buscar entre todas las OC abiertas del proveedor: número, fecha o monto"
                  className="w-full h-9 rounded-md border border-border bg-background pl-9 pr-3 text-[0.8125rem] text-foreground outline-none focus:border-primary focus:shadow-[0_0_0_3px_oklch(0.48_0.15_182_/_0.12)]"
                />
              </div>
              <button type="button" onClick={() => setShowAll((v) => !v)} className="h-9 whitespace-nowrap rounded-md border border-border bg-card px-3 text-xs font-semibold text-foreground hover:bg-secondary">
                {showAll ? "Ocultar" : `Ver las ${openPOs.length}`}
              </button>
            </div>
          )}
          {requirement !== "required" && (
            <button type="button" disabled={disabled} onClick={() => onSelect("")} className={cn("self-start text-xs", selectedId ? "text-primary hover:underline" : "text-muted-foreground")}>
              {selectedId ? "Quitar OC y enviar como factura sin OC" : "Sin OC seleccionada: se enviará como factura independiente"}
            </button>
          )}
        </div>
      )}
    </Card>
  );
}

// ── Invoice ↔ PO comparison ──────────────────────────────────────────────────

export function lineResult(l: LineComparison): { tone: Tone; label: string } {
  switch (l.status) {
    case "match": return { tone: "ok", label: "Coincide" };
    case "price_within_tolerance": return { tone: "warn", label: `Precio ${signedPct(l.priceDiffPct ?? 0)} · en tolerancia` };
    case "price_mismatch": return { tone: "err", label: `Precio ${signedPct(l.priceDiffPct ?? 0)} · fuera de tolerancia` };
    case "qty_over": return { tone: "err", label: "Más cantidad que la pendiente" };
    case "not_received": return { tone: "err", label: `Faltan ${l.missingReceipt.toLocaleString("es-MX")} por recibir` };
    default: return { tone: "warn", label: "No está en la OC" };
  }
}

export function PoComparisonCard({
  comparison, itemCodes, tolerance, requireReceipt, loading,
}: {
  comparison: PoComparison;
  itemCodes?: Record<number, string>;
  tolerance?: { price: number; qty: number } | null;
  requireReceipt: boolean;
  loading?: boolean;
}) {
  const c = comparison.counts;
  const priceDiff = c.price_within_tolerance + c.price_mismatch;
  const qty = (n: number | null) => (n === null ? "—" : n.toLocaleString("es-MX", { maximumFractionDigits: 3 }));
  return (
    <Card className={cn("overflow-hidden transition-opacity", loading && "opacity-60")}>
      <div className="px-4 py-3.5 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-foreground mr-1">Factura vs {comparison.poTranid || `OC #${comparison.poInternalId}`}</h2>
        {c.match > 0 && <Badge tone="ok">{c.match} coinciden</Badge>}
        {priceDiff > 0 && <Badge tone={c.price_mismatch ? "err" : "warn"}>{priceDiff} diferencia{priceDiff === 1 ? "" : "s"} de precio</Badge>}
        {c.qty_over > 0 && <Badge tone="err">{c.qty_over} con cantidad de más</Badge>}
        {c.not_received > 0 && <Badge tone="err">{c.not_received} sin recepción completa</Badge>}
        {c.not_in_po > 0 && <Badge tone="warn">{c.not_in_po} no está{c.not_in_po === 1 ? "" : "n"} en la OC</Badge>}
        {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
        {tolerance && <span className="ml-auto text-xs text-muted-foreground">Tolerancia precio {tolerance.price}% · cantidad {tolerance.qty}%</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[0.8125rem]">
          <thead className="bg-secondary/60 border-y border-border">
            <tr>
              {["Línea de la factura", "Ítem ERP", "Cant.", "Pend. en OC", ...(requireReceipt ? ["Recibido"] : []), "Precio fact. / OC", "Resultado"].map((h, i) => (
                <th key={h} className={cn("px-3 py-2.5 text-[0.65625rem] font-semibold uppercase tracking-[0.05em] text-muted-foreground whitespace-nowrap", i >= 2 && h !== "Resultado" ? "text-right" : "text-left")}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {comparison.lines.map((l) => {
              const r = lineResult(l);
              return (
                <tr key={l.index}>
                  <td className="px-3 py-2.5 text-foreground max-w-[260px] truncate">{l.description || "—"}</td>
                  <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{itemCodes?.[l.index] ?? l.itemId ?? "—"}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{qty(l.quantity)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{qty(l.poPending)}</td>
                  {requireReceipt && (
                    <td className={cn("px-3 py-2.5 text-right tabular-nums", l.status === "not_received" && "font-semibold text-destructive")}>{qty(l.poReceivedAvailable)}</td>
                  )}
                  <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">{money(l.rate)} / {money(l.poRate)}</td>
                  <td className="px-3 py-2.5"><Badge tone={r.tone}>{r.label}</Badge></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap justify-end gap-x-7 gap-y-1 px-4 py-3 text-[0.8125rem] border-t border-border">
        <span>Factura <strong className="tabular-nums">${money(comparison.invoiceTotal)}</strong></span>
        <span>OC <strong className="tabular-nums">${money(comparison.poTotal)}</strong></span>
        <span>Diferencia <strong className={cn("tabular-nums", comparison.totalWithinTolerance ? "text-success" : "text-destructive")}>{signed(comparison.totalDifference)} ({signedPct(comparison.totalDifferencePct)})</strong></span>
      </div>
    </Card>
  );
}

export function outcomeTone(outcome: PoOutcome | null): Tone {
  if (!outcome || outcome.kind === "ok") return "ok";
  if (outcome.kind === "needs_review") return "warn";
  return "err";
}
