// Per-vendor AP processing policy. The most specific rule wins:
// vendor → vendor category (from the ERP) → the organization's default rule →
// the feature configuration configured from super admin.

export type PoRequirement = "required" | "optional" | "none";
export type MismatchAction = "approval" | "block" | "warn";

export interface VendorRuleConfig {
  poRequirement:     PoRequirement;
  requireReceipt:    boolean;
  totalTolerancePct: number | null;
  priceTolerancePct: number | null;
  onMismatch:        MismatchAction | null;
  satRequired:       boolean;
  /** Minimum confidence (0–100) to send automatically; null = the organization's threshold. */
  autoProcessPct:    number | null;
  /** Always leave invoices of this vendor for a person to review. */
  neverAutoProcess:  boolean;
}

export interface VendorRuleRow {
  id: string;
  scope: "default" | "category" | "vendor";
  targetKey: string;
  targetLabel: string | null;
  config: unknown;
}

export interface EffectiveVendorRule extends VendorRuleConfig {
  ruleId:    string | null;
  ruleLabel: string;
}

const clampPct = (value: unknown, max = 100): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : null;
};

/** Parses a stored rule; unknown or invalid fields fall back to neutral values. */
export function parseVendorRuleConfig(raw: unknown): VendorRuleConfig {
  const c = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const po = c.poRequirement === "required" || c.poRequirement === "none" ? c.poRequirement : "optional";
  const mismatch = c.onMismatch === "approval" || c.onMismatch === "block" || c.onMismatch === "warn" ? c.onMismatch : null;
  return {
    poRequirement:     po,
    requireReceipt:    c.requireReceipt === true,
    totalTolerancePct: clampPct(c.totalTolerancePct),
    priceTolerancePct: clampPct(c.priceTolerancePct),
    onMismatch:        mismatch,
    satRequired:       c.satRequired !== false,
    autoProcessPct:    clampPct(c.autoProcessPct),
    neverAutoProcess:  c.neverAutoProcess === true,
  };
}

export function resolveVendorRule(
  rules: VendorRuleRow[],
  vendor: { internalId: string | null; categoryId: string | null },
  fallback: VendorRuleConfig,
): EffectiveVendorRule {
  const pick =
    (vendor.internalId && rules.find((r) => r.scope === "vendor" && r.targetKey === vendor.internalId))
    || (vendor.categoryId && rules.find((r) => r.scope === "category" && r.targetKey === vendor.categoryId))
    || rules.find((r) => r.scope === "default");
  if (!pick) return { ...fallback, ruleId: null, ruleLabel: "Configuración general" };
  const label = pick.scope === "default"
    ? "Predeterminada"
    : `${pick.scope === "category" ? "Categoría" : "Proveedor"}: ${pick.targetLabel ?? pick.targetKey}`;
  return { ...parseVendorRuleConfig(pick.config), ruleId: pick.id, ruleLabel: label };
}
