// Etapas de una factura (Datos y líneas · Orden de compra · Validación fiscal ·
// Envío al ERP) y su estado. Puro: lo usan la pantalla de revisión, el detalle y las pruebas.
import type { StageState } from "@/components/kit/stage-nav";
import type { FiscalValidation } from "@/lib/cfdi/validation";
import type { PoComparison, PoOutcome } from "@/lib/workflow/po-match";

export type InvoiceTab = "lines" | "po" | "fiscal" | "erp";
export const INVOICE_TABS: InvoiceTab[] = ["lines", "po", "fiscal", "erp"];

export function parseInvoiceTab(v: string | undefined | null): InvoiceTab {
  return INVOICE_TABS.includes(v as InvoiceTab) ? (v as InvoiceTab) : "lines";
}

const short = (s: string, max = 34) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

export interface StageInput {
  lines: { total: number; missing: number };
  vendorMissing?: boolean;
  po: {
    enabled: boolean;
    required?: boolean;
    selected?: string | null;
    comparison?: PoComparison | null;
    outcome?: PoOutcome | null;
    suggestions?: number;
    loading?: boolean;
  };
  fiscal: FiscalValidation | null;
  isCfdi: boolean;
  erp: { state: StageState; detail: string };
}

/**
 * Las cuatro etapas de una factura (Datos y líneas · Orden de compra · Validación
 * fiscal · Envío al ERP) con su estado. Las etapas que no aplican quedan apagadas.
 */
export function invoiceStages(i: StageInput): Array<{ key: InvoiceTab; label: string; state: StageState; detail: string; navigable: boolean }> {
  const lines = i.vendorMissing
    ? { state: "warn" as const, detail: "Falta el proveedor" }
    : i.lines.total === 0
      ? { state: "off" as const, detail: "Sin líneas leídas" }
    : i.lines.missing > 0
      ? { state: "warn" as const, detail: `${i.lines.missing} línea${i.lines.missing === 1 ? "" : "s"} sin ítem` }
      : { state: "ok" as const, detail: `${i.lines.total} línea${i.lines.total === 1 ? "" : "s"} con ítem` };

  let po: { state: StageState; detail: string; navigable: boolean };
  if (!i.po.enabled) po = { state: "off", detail: "No aplica", navigable: false };
  else if (i.po.loading) po = { state: "run", detail: "Comparando…", navigable: true };
  else if (!i.po.selected) {
    po = i.po.required
      ? { state: "err", detail: "El proveedor exige OC", navigable: true }
      : (i.po.suggestions ?? 0) > 0
        ? { state: "warn", detail: "Hay una OC sugerida", navigable: true }
        : { state: "off", detail: "Sin OC", navigable: true };
  } else {
    const tranid = i.po.comparison?.poTranid ?? i.po.selected;
    const o = i.po.outcome;
    po = !o || o.kind === "ok"
      ? { state: "ok", detail: o ? `Cuadra con ${tranid}` : tranid, navigable: true }
      : o.kind === "await_receipt"
        ? { state: "warn", detail: "Falta la recepción", navigable: true }
        : { state: o.kind === "blocked" ? "err" : "warn", detail: short(o.reason), navigable: true };
  }

  const fiscal = !i.isCfdi
    ? { state: "off" as const, detail: "No aplica a PDF", navigable: false }
    : !i.fiscal
      ? { state: "off" as const, detail: "Sin consultar", navigable: true }
      : i.fiscal.outcome === "ok"
        ? { state: "ok" as const, detail: "CFDI válido", navigable: true }
        : { state: (i.fiscal.outcome === "blocked" ? "err" : "warn") as StageState, detail: short(i.fiscal.reason ?? "Revisar el CFDI"), navigable: true };

  return [
    { key: "lines", label: "Datos y líneas", ...lines, navigable: true },
    { key: "po", label: "Orden de compra", ...po },
    { key: "fiscal", label: "Validación fiscal", ...fiscal },
    { key: "erp", label: "Envío al ERP", ...i.erp, navigable: true },
  ];
}
