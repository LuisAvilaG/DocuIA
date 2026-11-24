// Motivos de error legibles: los errores técnicos (respuestas crudas de la IA o del
// ERP, trazas, JSON) se traducen a una frase corta. Los motivos ya escritos para
// personas pasan tal cual.

const RULES: Array<[RegExp, string]> = [
  // The ERP account requires a location and the invoice went without one.
  [/(?:introduzca valores para|please enter value\(s\) for)\s*:?.*(?:ubicaci[oó]n|location)/i, "El ERP pide la ubicación de la factura. Elígela al revisarla, o define la ubicación predeterminada en Ajustes de Facturas → Subsidiarias."],
  // The ERP client reports "HTTP 401: …"; the reading service never does.
  [/^HTTP (?:401|403)\b|(?:netsuite|restlet|\bERP\b).*(?:unauthori[sz]ed|invalid login)/i, "El ERP rechazó la conexión. Revisa las credenciales del ERP."],
  [/^HTTP (?:429|5\d\d)\b|(?:netsuite|restlet|\bERP\b).*(?:timeout|timed out|ECONN|fetch failed)/i, "El ERP no respondió. Reintenta en unos minutos."],
  [/pdf.*(not valid|invalid|corrupt)|could not process (the )?(pdf|image)|unsupported (image|file)/i, "No se pudo leer el archivo. Revisa que no esté dañado o protegido."],
  [/api[_ ]?key|unauthori[sz]ed|authentication|permission denied/i, "Falta configurar el acceso al servicio de lectura. Avísale a DocuIA."],
  // 429/503 only as a status: at the start of a raw provider error or after
  // "HTTP"/"status", not inside an invoice number or an amount.
  [/rate.?limit|overloaded|^\s*(?:429|503)\b|\b(?:HTTP|status(?: code)?)\s*:?\s*(?:429|503)\b|timeout|timed out|ECONN|fetch failed/i, "El servicio de lectura no respondió. Reintenta en unos minutos."],
];

/** Convierte un mensaje de error técnico en una frase para el usuario. */
export function friendlyError(message: string | null | undefined): string | null {
  if (!message) return null;
  const text = message.trim();
  for (const [re, phrase] of RULES) if (re.test(text)) return phrase;
  const technical = /^Unknown feature\b/i.test(text) || /^\d{3}\s*[{[]/.test(text) || /"type"\s*:\s*"error"/.test(text) || /^\s*[{[]/.test(text) || /\bat\s+\S+\s+\(.*:\d+:\d+\)/.test(text);
  return technical ? "Ocurrió un error técnico al procesarlo. Reintenta o avísale a DocuIA." : text;
}
