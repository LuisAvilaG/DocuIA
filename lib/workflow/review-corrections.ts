// Qué cambió la persona entre lo que leyó la IA y lo que se envía al ERP.
// Se guarda al enviar (products.review_corrections) para la métrica
// «Precisión de lectura»: qué campos se corrigen más.
import type { NsDraft } from "./ns-payload";

export const CORRECTION_LABEL: Record<string, string> = {
  vendor: "Proveedor", invoice_number: "Número de factura", invoice_date: "Fecha", due_date: "Vencimiento",
  currency: "Moneda", line_count: "Líneas agregadas o quitadas", item: "Ítem del ERP", quantity: "Cantidad",
  rate: "Precio unitario", amount: "Importe de línea",
};

type PayloadLike = {
  document?: {
    vendor?: { selected_internal_id?: string | null };
    invoice_number?: string | null; invoice_date?: string | null; due_date?: string | null; currency?: string | null;
    lines?: Array<{ selected_item_id?: string | null; quantity?: number | null; rate?: number | null; amount?: number | null }>;
  };
};

const same = (a: unknown, b: unknown) => (a ?? "") === "" && (b ?? "") === "" ? true : String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();
const sameNum = (a: number | null | undefined, b: number | null | undefined) =>
  a === null || a === undefined || b === null || b === undefined ? (a ?? null) === (b ?? null) : Math.abs(a - b) <= 0.005 * Math.max(1, Math.abs(a));

/** Campos corregidos y cuántas veces (las líneas cuentan una vez por línea). */
export function reviewCorrections(payload: unknown, draft: NsDraft): Record<string, number> {
  const doc = (payload as PayloadLike | null)?.document;
  if (!doc) return {};
  const out: Record<string, number> = {};
  const add = (k: string) => { out[k] = (out[k] ?? 0) + 1; };
  if (doc.vendor?.selected_internal_id && !same(doc.vendor.selected_internal_id, draft.vendorId)) add("vendor");
  if (!same(doc.invoice_number, draft.invoiceNumber)) add("invoice_number");
  if (!same(doc.invoice_date, draft.invoiceDate)) add("invoice_date");
  if (!same(doc.due_date, draft.dueDate)) add("due_date");
  if (doc.currency && draft.currency && !same(doc.currency, draft.currency)) add("currency");
  const read = doc.lines ?? [];
  if (read.length !== draft.lines.length) add("line_count");
  for (let i = 0; i < Math.min(read.length, draft.lines.length); i++) {
    const r = read[i], d = draft.lines[i];
    if (r.selected_item_id && r.selected_item_id !== d.internal_id) add("item");
    if (!sameNum(r.quantity, d.quantity)) add("quantity");
    if (!sameNum(r.rate, d.rate)) add("rate");
    if (!sameNum(r.amount, d.amount)) add("amount");
  }
  return out;
}
