import { CASE_STATUS, TONE_PILL } from "@/lib/status-vocabulary";

// Single vocabulary for contract cases. Case status values are persisted in
// English for the API, but no raw value should reach a Spanish tenant UI.
// Labels and tones come from the single 2026 vocabulary (lib/status-vocabulary.ts):
// Analizando, Por decidir, Aprobado, Rechazado, Error.
function entry(key: keyof typeof CASE_STATUS) {
  const word = CASE_STATUS[key];
  return { label: word.label, cls: TONE_PILL[word.tone], tone: TONE_PILL[word.tone].split(" ")[1] };
}

export const CONTRACT_CASE_STATUS = {
  uploaded:   entry("uploaded"),
  processing: entry("processing"),
  review:     entry("review"),
  validated:  entry("validated"),
  generated:  entry("generated"),
  approved:   entry("approved"),
  rejected:   entry("rejected"),
  failed:     entry("failed"),
} as const;

const OUTCOME_LABELS: Record<string, string> = {
  approved: "Aprobado", approved_with_override: "Aprobado con excepción",
  rejected: "Rechazado", validated: "Validado", valid: "Validado",
  pending: "Pendiente", processing: "Procesando", unknown: "Por revisar",
};

export function contractStatusLabel(value: string | null | undefined): string {
  if (!value) return "Sin estado";
  return CONTRACT_CASE_STATUS[value as keyof typeof CONTRACT_CASE_STATUS]?.label ?? OUTCOME_LABELS[value.toLowerCase()] ?? value;
}
