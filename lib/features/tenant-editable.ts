// Qué puede cambiar el cliente por su cuenta en Ajustes (decisión 3 del plan del
// rediseño, 2026-11-10). Todo lo demás lo ajusta DocuIA desde el superadmin y el
// cliente solo lo ve. El superadmin siempre puede editarlo todo.
//
// - `toggle`: el cliente puede encender y apagar la feature (si el superadmin la concedió).
// - `keys`: campos de configuración que el cliente puede editar.

export interface TenantEditable {
  toggle?: boolean;
  keys?: readonly string[];
}

export const TENANT_EDITABLE: Record<string, TenantEditable> = {
  po_matching: {
    keys: ["suggest_by_number", "suggest_by_total", "auto_select_single", "total_tolerance_type", "total_tolerance_value", "price_tolerance_pct", "qty_tolerance_pct", "on_mismatch", "extra_lines"],
  },
  three_way_match:     { keys: ["recheck_hours", "max_wait_days", "on_timeout", "scope"] },
  approval_workflow:   { toggle: true },
  duplicate_detection: { toggle: true },
  bulk_upload:         { keys: ["batch_mode", "batch_wait_minutes"] },
  auto_mapping:        { keys: ["min_confirmations"] },
  scheduled_reports:   { toggle: true, keys: ["frequency", "recipients", "report_scope"] },
};

/** Campos que el cliente puede editar de una feature (vacío si ninguno). */
export function tenantEditableKeys(featureId: string): readonly string[] {
  return TENANT_EDITABLE[featureId]?.keys ?? [];
}

/** Si el cliente puede encender o apagar la feature por su cuenta. */
export function tenantCanToggle(featureId: string): boolean {
  return TENANT_EDITABLE[featureId]?.toggle === true;
}
