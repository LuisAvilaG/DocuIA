import { getFeature } from "@/lib/features";

export interface ExpenseManagementConfig {
  countryCode: string;
  autoCreateVendor: boolean;
  duplicateCheckEnabled: boolean;
  spendingCapsEnabled: boolean;
  documentoEquivalenteFormId: string;
}

const DEFAULT_CONFIG: ExpenseManagementConfig = {
  countryCode: "CO",
  autoCreateVendor: true,
  duplicateCheckEnabled: true,
  spendingCapsEnabled: true,
  documentoEquivalenteFormId: "",
};

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asCountryCode(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  return /^[A-Z]{2,3}$/.test(normalized) ? normalized : DEFAULT_CONFIG.countryCode;
}

/** Resolves the effective expense settings after catalog defaults and tenant overrides. */
export async function getExpenseManagementConfig(organizationId: string): Promise<ExpenseManagementConfig> {
  const feature = await getFeature(organizationId, "expense_management");
  const config = feature.config;

  return {
    countryCode: asCountryCode(config.country_code),
    autoCreateVendor: asBoolean(config.auto_create_vendor, DEFAULT_CONFIG.autoCreateVendor),
    duplicateCheckEnabled: asBoolean(config.duplicate_check_enabled, DEFAULT_CONFIG.duplicateCheckEnabled),
    spendingCapsEnabled: asBoolean(config.spending_caps_enabled, DEFAULT_CONFIG.spendingCapsEnabled),
    documentoEquivalenteFormId: typeof config.documento_equivalente_form_id === "string"
      ? config.documento_equivalente_form_id.trim()
      : DEFAULT_CONFIG.documentoEquivalenteFormId,
  };
}

/** Validates the values a platform admin can persist for this feature. */
export function validateExpenseManagementConfig(config: Record<string, unknown>): string | null {
  if ("country_code" in config) {
    const countryCode = config.country_code;
    if (typeof countryCode !== "string" || !/^[A-Za-z]{2,3}$/.test(countryCode.trim())) {
      return "El país principal debe ser un código ISO de 2 o 3 letras (por ejemplo, CO o MX)";
    }
  }

  for (const key of ["auto_create_vendor", "duplicate_check_enabled", "spending_caps_enabled"] as const) {
    if (key in config && typeof config[key] !== "boolean") {
      return `La opción ${key} debe ser verdadera o falsa`;
    }
  }

  if ("documento_equivalente_form_id" in config) {
    const formId = config.documento_equivalente_form_id;
    if (typeof formId !== "string" || (formId.trim() !== "" && !/^\d+$/.test(formId.trim()))) {
      return "El Custom Form ID de Documento Equivalente debe ser el Internal ID numérico de NetSuite";
    }
  }

  return null;
}
