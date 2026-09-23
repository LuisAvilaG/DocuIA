export type CfdiLine = {
  claveProdServ: string;
  noIdentificacion: string;
  cantidad: number;
  claveUnidad: string;
  descripcion: string;
  valorUnitario: number;
  importe: number;
  descuento: number;
};

export type CfdiData = {
  version: string;
  serie: string;
  folio: string;
  metodoPago: string;
  formaPago: string;
  fecha: string;
  uuid: string;
  tipoComprobante: string;
  subTotal: number;
  descuento: number;
  totalTraslados: number;    // TotalImpuestosTrasladados (e.g. IVA)
  totalRetenciones: number;  // TotalImpuestosRetenidos (retenciones)
  total: number;
  moneda: string;
  emisorRfc: string;
  emisorNombre: string;
  receptorRfc: string;
  receptorNombre: string;
  usoCfdi: string;
  lineas: CfdiLine[];
};

function attr(xml: string, name: string): string {
  const re = new RegExp(`(?:^|\\s)${name}="([^"]*)"`, "i");
  return re.exec(xml)?.[1]?.trim() ?? "";
}

function num(v: string): number {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function extractTag(xml: string, tag: string): string {
  // Lookahead (?=[\s/>]) prevents matching a longer sibling tag
  // (e.g. tag "Concepto" must NOT match "<cfdi:Conceptos>").
  const re = new RegExp(`<(?:cfdi:)?${tag}(?=[\\s/>])[^>]*>`, "i");
  return re.exec(xml)?.[0] ?? "";
}

function extractAllTags(xml: string, tag: string): string[] {
  const re = new RegExp(`<(?:cfdi:)?${tag}(?=[\\s/>])[^>]*/?>`, "gi");
  return xml.match(re) ?? [];
}

function extractUUID(xml: string): string {
  const tfd = /<tfd:TimbreFiscalDigital[^>]*/i.exec(xml)?.[0] ?? "";
  return attr(tfd, "UUID");
}

/**
 * Purchase-order number cited anywhere in the CFDI (CondicionesDePago, concept
 * descriptions, Addenda…). Suppliers write it in different places, so the whole
 * document is scanned for "OC/PO/Orden de compra" followed by a number.
 */
export function findPoReference(xmlText: string): string {
  // Seals and certificates are long base64 strings that can contain "PO123…".
  const text = xmlText
    .replace(/\s(?:Sello|SelloCFD|SelloSAT|Certificado|NoCertificado|NoCertificadoSAT)="[^"]*"/gi, " ")
    .replace(/&[a-z#0-9]+;/gi, " ");
  const labeled = /(?:orden\s+de\s+compra|pedido|\bO\.?\s?C\.?|\bP\.?\s?O\.?)\s*(?:n[oº°.]*|#|:|-)?\s*([A-Z]{0,4}-?\d{3,12})\b/i.exec(text);
  if (labeled) return labeled[1].toUpperCase();
  const bare = /\b((?:PO|OC)-?\d{4,12})\b/i.exec(text);
  return bare ? bare[1].toUpperCase() : "";
}

export function parseCfdi(xmlText: string): CfdiData {
  const comprobante = /<cfdi:Comprobante[^>]*/i.exec(xmlText)?.[0] ?? xmlText;
  const emisorTag   = extractTag(xmlText, "Emisor");
  const receptorTag = extractTag(xmlText, "Receptor");
  const conceptos   = extractAllTags(xmlText, "Concepto");

  const lineas: CfdiLine[] = conceptos
    .map(c => ({
      claveProdServ:    attr(c, "ClaveProdServ"),
      noIdentificacion: attr(c, "NoIdentificacion"),
      cantidad:         num(attr(c, "Cantidad")),
      claveUnidad:      attr(c, "ClaveUnidad"),
      descripcion:      attr(c, "Descripcion"),
      valorUnitario:    num(attr(c, "ValorUnitario")),
      importe:          num(attr(c, "Importe")),
      descuento:        num(attr(c, "Descuento")),
    }))
    // Defensive: drop any empty phantom line (no description, no amount, no qty)
    .filter(l => l.descripcion || l.importe || l.cantidad);

  // Global tax totals live only on the Comprobante-level <cfdi:Impuestos> node,
  // so these attribute names are unique in the document.
  const totalTraslados   = num(attr(xmlText, "TotalImpuestosTrasladados"));
  const totalRetenciones = num(attr(xmlText, "TotalImpuestosRetenidos"));

  return {
    version:          attr(comprobante, "Version") || attr(comprobante, "version"),
    serie:            attr(comprobante, "Serie"),
    folio:            attr(comprobante, "Folio"),
    metodoPago:       attr(comprobante, "MetodoPago"),
    formaPago:        attr(comprobante, "FormaPago"),
    fecha:            attr(comprobante, "Fecha"),
    uuid:             extractUUID(xmlText),
    tipoComprobante:  attr(comprobante, "TipoDeComprobante"),
    subTotal:         num(attr(comprobante, "SubTotal")),
    descuento:        num(attr(comprobante, "Descuento")),
    totalTraslados,
    totalRetenciones,
    total:            num(attr(comprobante, "Total")),
    moneda:           attr(comprobante, "Moneda"),
    emisorRfc:        attr(emisorTag, "Rfc"),
    emisorNombre:     attr(emisorTag, "Nombre"),
    receptorRfc:      attr(receptorTag, "Rfc"),
    receptorNombre:   attr(receptorTag, "Nombre"),
    usoCfdi:          attr(receptorTag, "UsoCFDI"),
    lineas,
  };
}

