// Formato en que llegan las facturas de proveedores de una subsidiaria (decisión 2
// del plan del rediseño): lo fija el superadmin y define qué pide la carga.
//   cfdi → XML del CFDI + PDF (México)
//   pdf  → PDF o imagen (resto)

export type InvoiceFormat = "cfdi" | "pdf";

export const INVOICE_FORMATS: readonly InvoiceFormat[] = ["cfdi", "pdf"];

export const INVOICE_FORMAT_LABEL: Record<InvoiceFormat, string> = {
  cfdi: "CFDI · XML + PDF",
  pdf:  "PDF o imagen",
};

export function isInvoiceFormat(v: unknown): v is InvoiceFormat {
  return v === "cfdi" || v === "pdf";
}

/** Sugerencia al dar de alta una subsidiaria: CFDI si es mexicana. */
export function suggestInvoiceFormat(locale: string | null | undefined, currency: string | null | undefined): InvoiceFormat {
  return locale === "es-MX" || currency?.toUpperCase() === "MXN" ? "cfdi" : "pdf";
}

/**
 * Si el tipo de documento no corresponde con el formato de la subsidiaria, el
 * motivo para rechazar la carga. Las órdenes de compra no dependen del formato.
 */
export function formatMismatch(format: string | null | undefined, documentType: string): string | null {
  if (documentType === "purchase_order") return null;
  if (format === "cfdi" && documentType !== "xml_cfdi") return "Esta subsidiaria recibe facturas con CFDI: sube el XML (y su PDF si lo tienes).";
  if (format === "pdf" && documentType === "xml_cfdi") return "Esta subsidiaria recibe facturas en PDF o imagen, sin XML.";
  return null;
}
