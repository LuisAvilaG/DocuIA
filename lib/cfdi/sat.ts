// SAT "Consulta de CFDI" web service: tells whether a CFDI is Vigente,
// Cancelado or No Encontrado. Public SOAP endpoint, no credentials.

const SAT_URL = "https://consultaqr.facturaelectronica.sat.gob.mx/ConsultaCFDIService.svc";
const SAT_ACTION = "http://tempuri.org/IConsultaCFDIService/Consulta";
const SAT_TIMEOUT_MS = Number(process.env.SAT_TIMEOUT_MS) || 15_000;

export interface SatStatus {
  /** "Vigente" | "Cancelado" | "No Encontrado" (as returned by the SAT). */
  estado: string;
  codigoEstatus: string;
  esCancelable: string;
  estatusCancelacion: string;
  validacionEfos: string;
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The "expresión impresa" the SAT expects: emisor, receptor, total and UUID. */
export function satExpression(input: { emisorRfc: string; receptorRfc: string; total: number; uuid: string }): string {
  const clean = (rfc: string) => rfc.trim().toUpperCase();
  return `?re=${clean(input.emisorRfc)}&rr=${clean(input.receptorRfc)}&tt=${input.total.toFixed(2)}&id=${input.uuid.trim().toUpperCase()}`;
}

function tag(xml: string, name: string): string {
  const match = new RegExp(`<(?:[a-zA-Z]+:)?${name}(?:\\s[^>]*)?>([^<]*)</(?:[a-zA-Z]+:)?${name}>`).exec(xml);
  return (match?.[1] ?? "").trim();
}

export function parseSatResponse(xml: string): SatStatus | null {
  const estado = tag(xml, "Estado");
  if (!estado) return null;
  return {
    estado,
    codigoEstatus: tag(xml, "CodigoEstatus"),
    esCancelable: tag(xml, "EsCancelable"),
    estatusCancelacion: tag(xml, "EstatusCancelacion"),
    validacionEfos: tag(xml, "ValidacionEFOS"),
  };
}

export async function consultSatStatus(input: { emisorRfc: string; receptorRfc: string; total: number; uuid: string }): Promise<SatStatus> {
  const body = `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tem="http://tempuri.org/">
<soapenv:Header/>
<soapenv:Body><tem:Consulta><tem:expresionImpresa>${xmlEscape(satExpression(input))}</tem:expresionImpresa></tem:Consulta></soapenv:Body>
</soapenv:Envelope>`;
  const res = await fetch(SAT_URL, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: SAT_ACTION },
    body,
    signal: AbortSignal.timeout(SAT_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`El SAT respondió HTTP ${res.status}`);
  const status = parseSatResponse(await res.text());
  if (!status) throw new Error("Respuesta del SAT sin estado");
  return status;
}
