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

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

// Attribute values arrive escaped ("Pérez &amp; Hijos", "&#209;"). One pass, so
// "&amp;lt;" becomes "&lt;" and not "<".
export function decodeXmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] !== "#") return XML_ENTITIES[entity.toLowerCase()] ?? match;
    const code = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}

// Inside a tag: anything but ">" or a quote, or a whole quoted value (which
// may contain ">": several serializers do not escape it in attributes).
const TAG_BODY = `(?:[^>"']|"[^"]*"|'[^']*')*`;

function attr(xml: string, name: string): string {
  const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i");
  const m = re.exec(xml);
  return decodeXmlEntities(m?.[1] ?? m?.[2] ?? "").trim();
}

/**
 * Number the invoice is known by. Folios restart in every Serie, so A-123 and
 * B-123 are different invoices; without a folio the UUID identifies it.
 */
export function cfdiInvoiceNumber(cfdi: Pick<CfdiData, "serie" | "folio" | "uuid">): string {
  if (!cfdi.folio) return cfdi.uuid.slice(0, 8);
  return cfdi.serie ? `${cfdi.serie}-${cfdi.folio}` : cfdi.folio;
}

function num(v: string): number {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function extractTag(xml: string, tag: string): string {
  // Lookahead (?=[\s/>]) prevents matching a longer sibling tag
  // (e.g. tag "Concepto" must NOT match "<cfdi:Conceptos>").
  const re = new RegExp(`<(?:cfdi:)?${tag}(?=[\\s/>])${TAG_BODY}>`, "i");
  return re.exec(xml)?.[0] ?? "";
}

function extractAllTags(xml: string, tag: string): string[] {
  const re = new RegExp(`<(?:cfdi:)?${tag}(?=[\\s/>])${TAG_BODY}>`, "gi");
  return xml.match(re) ?? [];
}

function extractUUID(xml: string): string {
  const tfd = new RegExp(`<tfd:TimbreFiscalDigital${TAG_BODY}`, "i").exec(xml)?.[0] ?? "";
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
  // The short forms must end there: "OCT2024" or "POS-1234" are not "OC T2024" / "PO S-1234".
  const labeled = /(?:orden\s+de\s+compra|pedido|(?:\bO\.?\s?C\.?|\bP\.?\s?O\.?)(?![a-z]))\s*(?:n[oº°.]*|#|:|-)?\s*([A-Z]{0,4}-?\d{3,12})\b/i.exec(text);
  if (labeled) return labeled[1].toUpperCase();
  const bare = /\b((?:PO|OC)-?\d{4,12})\b/i.exec(text);
  return bare ? bare[1].toUpperCase() : "";
}

const CFDI_TYPES: Record<string, string> = { E: "egreso (nota de crédito)", P: "pago", T: "traslado", N: "nómina" };

/**
 * Only "I" (ingreso) is a vendor invoice. A credit note posted as a bill would
 * add to the payable instead of reducing it. Returns why it cannot be
 * processed, or null when it can (a CFDI without the attribute is let through).
 */
export function cfdiNotInvoiceReason(tipoComprobante: string): string | null {
  const tipo = tipoComprobante.trim().toUpperCase();
  if (!tipo || tipo === "I") return null;
  return `El CFDI es de tipo ${CFDI_TYPES[tipo] ?? tipo}, no una factura de ingreso: no se registra como factura de proveedor.`;
}

export function parseCfdi(xmlText: string): CfdiData {
  const comprobante = new RegExp(`<cfdi:Comprobante${TAG_BODY}`, "i").exec(xmlText)?.[0] ?? xmlText;
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

