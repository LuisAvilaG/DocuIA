// Motivos de error legibles: los errores técnicos (respuestas crudas de la IA o del
// ERP, trazas, JSON) se traducen a una frase corta. Los motivos ya escritos para
// personas pasan tal cual.

const RULES: Array<[RegExp, string]> = [
  [/pdf.*(not valid|invalid|corrupt)|could not process (the )?(pdf|image)|unsupported (image|file)/i, "No se pudo leer el archivo. Revisa que no esté dañado o protegido."],
  [/api[_ ]?key|unauthori[sz]ed|authentication|permission denied/i, "Falta configurar el acceso al servicio de lectura. Avísale a DocuIA."],
  [/rate.?limit|overloaded|429|503|timeout|timed out|ECONN|fetch failed/i, "El servicio de lectura no respondió. Reintenta en unos minutos."],
];

/** Convierte un mensaje de error técnico en una frase para el usuario. */
export function friendlyError(message: string | null | undefined): string | null {
  if (!message) return null;
  const text = message.trim();
  for (const [re, phrase] of RULES) if (re.test(text)) return phrase;
  const technical = /^\d{3}\s*[{[]/.test(text) || /"type"\s*:\s*"error"/.test(text) || /^\s*[{[]/.test(text) || /\bat\s+\S+\s+\(.*:\d+:\d+\)/.test(text);
  return technical ? "Ocurrió un error técnico al procesarlo. Reintenta o avísale a DocuIA." : text;
}
