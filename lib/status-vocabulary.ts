// Vocabulario único de estados del rediseño 2026. Cada estado técnico (en inglés,
// persistido en la base) se muestra con una etiqueta clara en español y un tono.
// Los tonos tienen fondo y texto con contraste AA (ver tokens --tone-* en globals.css).

export type Tone = "ok" | "warn" | "err" | "info" | "blue" | "mute";

/** Clases de Tailwind para una píldora de cada tono. */
export const TONE_PILL: Record<Tone, string> = {
  ok:   "bg-tone-ok-bg text-tone-ok",
  warn: "bg-tone-warn-bg text-tone-warn",
  err:  "bg-tone-err-bg text-tone-err",
  info: "bg-tone-info-bg text-tone-info",
  blue: "bg-tone-blue-bg text-tone-blue",
  mute: "bg-tone-mute-bg text-tone-mute",
};

/** Clase del punto de color que acompaña una etiqueta de estado en tablas. */
export const TONE_DOT: Record<Tone, string> = {
  ok:   "bg-tone-ok",
  warn: "bg-tone-warn",
  err:  "bg-tone-err",
  info: "bg-tone-info",
  blue: "bg-tone-blue",
  mute: "bg-tone-mute",
};

export interface StatusWord {
  label: string;
  tone: Tone;
}

/** Facturas (history_documents.status). */
export const AP_STATUS: Record<string, StatusWord> = {
  uploaded:         { label: "Leyendo",             tone: "info" },
  extracting:       { label: "Leyendo",             tone: "info" },
  review:           { label: "Por revisar",         tone: "warn" },
  pending_approval: { label: "Por aprobar",         tone: "blue" },
  approved:         { label: "Aprobado",            tone: "ok" },
  processing:       { label: "Enviando al ERP",     tone: "info" },
  completed:        { label: "En el ERP",           tone: "ok" },
  failed:           { label: "Con error",           tone: "err" },
  awaiting_receipt: { label: "Esperando recepción", tone: "mute" },
};

/** Contratos (contract_cases.status). Cinco palabras para el usuario. */
export const CASE_STATUS: Record<string, StatusWord> = {
  uploaded:   { label: "Analizando",  tone: "info" },
  processing: { label: "Analizando",  tone: "info" },
  review:     { label: "Por decidir", tone: "warn" },
  validated:  { label: "Por decidir", tone: "warn" },
  generated:  { label: "Aprobado",    tone: "ok" },
  approved:   { label: "Aprobado",    tone: "ok" },
  rejected:   { label: "Rechazado",   tone: "mute" },
  awaiting_documents: { label: "Esperando documentos", tone: "blue" },
  failed:     { label: "Error",       tone: "err" },
};

const UNKNOWN: StatusWord = { label: "Sin estado", tone: "mute" };

export function apStatus(value: string | null | undefined): StatusWord {
  return (value && AP_STATUS[value]) || (value ? { label: value, tone: "mute" } : UNKNOWN);
}

export function caseStatus(value: string | null | undefined): StatusWord {
  return (value && CASE_STATUS[value]) || (value ? { label: value, tone: "mute" } : UNKNOWN);
}
