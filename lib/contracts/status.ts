// Single vocabulary for contract cases. Case status values are persisted in
// English for the API, but no raw value should reach a Spanish tenant UI.
export const CONTRACT_CASE_STATUS = {
  uploaded:   { label: "En cola",     cls: "bg-secondary text-muted-foreground", tone: "text-muted-foreground" },
  processing: { label: "Procesando",  cls: "bg-warning/10 text-warning",          tone: "text-warning" },
  review:     { label: "En revisión", cls: "bg-warning/10 text-warning",          tone: "text-warning" },
  validated:  { label: "Validado",    cls: "bg-success/10 text-success",          tone: "text-success" },
  generated:  { label: "Generado",    cls: "bg-success/10 text-success",          tone: "text-success" },
  approved:   { label: "Aprobado",    cls: "bg-success/10 text-success",          tone: "text-success" },
  rejected:   { label: "Rechazado",   cls: "bg-destructive/10 text-destructive",  tone: "text-destructive" },
  failed:     { label: "Error",       cls: "bg-destructive/10 text-destructive",  tone: "text-destructive" },
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
