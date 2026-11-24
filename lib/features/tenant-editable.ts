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
  auto_send:           { toggle: true },
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

/** Clave en la configuración donde se guarda que el cliente apagó la feature por su cuenta. */
export const TENANT_OFF_KEY = "tenant_off";

export interface SchemaParam {
  key: string;
  type: "boolean" | "number" | "string" | "select" | "date";
  min?: number;
  max?: number;
  options?: readonly string[];
  label?: string;
}

/**
 * Valida lo que el cliente quiere cambiar de una feature: solo campos marcados como
 * editables por el cliente y con el tipo y rango de su configSchema.
 */
export function validateTenantConfig(
  featureId: string,
  schema: readonly SchemaParam[] | null | undefined,
  patch: Record<string, unknown>,
): { ok: true; config: Record<string, unknown> } | { ok: false; error: string } {
  const allowed = new Set(tenantEditableKeys(featureId));
  const byKey = new Map((schema ?? []).map((p) => [p.key, p]));
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(patch)) {
    const p = byKey.get(key);
    if (!allowed.has(key) || !p) return { ok: false, error: `«${key}» lo ajusta DocuIA.` };
    const name = p.label ?? key;
    switch (p.type) {
      case "boolean":
        if (typeof raw !== "boolean") return { ok: false, error: `«${name}» debe ser sí o no.` };
        out[key] = raw;
        break;
      case "number": {
        const n = typeof raw === "number" ? raw : Number(raw);
        if (!Number.isFinite(n)) return { ok: false, error: `«${name}» debe ser un número.` };
        if ((p.min !== undefined && n < p.min) || (p.max !== undefined && n > p.max)) {
          return { ok: false, error: `«${name}» va de ${p.min ?? "—"} a ${p.max ?? "—"}.` };
        }
        out[key] = n;
        break;
      }
      case "select":
        if (typeof raw !== "string" || !(p.options ?? []).includes(raw)) return { ok: false, error: `«${name}» no es una opción válida.` };
        out[key] = raw;
        break;
      default:
        if (typeof raw !== "string" || raw.length > 500) return { ok: false, error: `«${name}» no es válido.` };
        out[key] = raw.trim();
    }
  }
  return { ok: true, config: out };
}
