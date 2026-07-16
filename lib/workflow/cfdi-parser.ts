export type CfdiLine = {
  claveProdServ: string;
  noIdentificacion: string;
  cantidad: number;
  claveUnidad: string;
  descripcion: string;
  valorUnitario: number;
  importe: number;
};

export type CfdiData = {
  version: string;
  folio: string;
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
    }))
    // Defensive: drop any empty phantom line (no description, no amount, no qty)
    .filter(l => l.descripcion || l.importe || l.cantidad);

  // Global tax totals live only on the Comprobante-level <cfdi:Impuestos> node,
  // so these attribute names are unique in the document.
  const totalTraslados   = num(attr(xmlText, "TotalImpuestosTrasladados"));
  const totalRetenciones = num(attr(xmlText, "TotalImpuestosRetenidos"));

  return {
    version:          attr(comprobante, "Version") || attr(comprobante, "version"),
    folio:            attr(comprobante, "Folio"),
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

