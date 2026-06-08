/**
 * Configurable tax rules engine for expense management.
 * Rules are stored in DB (expense_tax_rules) and resolved at runtime.
 * Default rules for CO and MX are seeded via seed-expense-rules.ts.
 */

export interface TaxRuleTrigger {
  category_ids?: string[];
  document_types?: string[];
  amount_range?: { min: number; max: number | null };
  vendor_regime?: string;
  country_code?: string;
}

export interface TaxRuleItem {
  type: string;            // "IVA" | "RETEFUENTE" | "RETEICA" | "ISR" | ...
  rate: number;            // e.g. 0.19 for 19%
  base: "subtotal" | "total";
  condition?: string;      // e.g. "amount > 867000" — evaluated at runtime
  ns_tax_code?: string;    // NetSuite taxcode internalId
}

export interface TaxRule {
  id?: number;
  organizationId?: string | null;
  countryCode: string;
  name: string;
  trigger: TaxRuleTrigger;
  taxes: TaxRuleItem[];
  priority: number;
}

export interface TaxCalculationInput {
  countryCode: string;
  categoryId?: string;
  documentType?: string;
  subtotal: number;
  vendorRegime?: string;
  orgRules?: TaxRule[];
}

export interface CalculatedTax {
  type: string;
  rate: number;
  base: number;
  amount: number;
  nsTaxCode?: string;
}

export interface TaxCalculationResult {
  taxes: CalculatedTax[];
  totalTax: number;
  totalRetention: number;
  total: number;
}

// ── Default rules (used when no DB rules exist for the org) ───────────

export const DEFAULT_TAX_RULES: TaxRule[] = [
  // Colombia — IVA 19% general (facturas y cuentas de cobro)
  {
    countryCode: "CO",
    name: "IVA Colombia 19%",
    trigger: { document_types: ["invoice", "cuenta_cobro"] },
    taxes: [{ type: "IVA", rate: 0.19, base: "subtotal", ns_tax_code: "IVA" }],
    priority: 10,
  },
  // Colombia — Retención en la fuente servicios (monto >= 867.000 COP)
  {
    countryCode: "CO",
    name: "Retención en la Fuente CO — Servicios",
    trigger: {
      document_types: ["invoice", "cuenta_cobro"],
      amount_range: { min: 867000, max: null },
    },
    taxes: [{ type: "RETEFUENTE", rate: 0.11, base: "subtotal", condition: "subtotal >= 867000", ns_tax_code: "RETEFUENTE_11" }],
    priority: 20,
  },
  // Colombia — ReteICA Bogotá (0.69% — common default)
  {
    countryCode: "CO",
    name: "Retención ICA Bogotá",
    trigger: {
      document_types: ["invoice", "cuenta_cobro"],
      amount_range: { min: 0, max: null },
    },
    taxes: [{ type: "RETEICA", rate: 0.0069, base: "subtotal", ns_tax_code: "RETEICA_69" }],
    priority: 30,
  },
  // Colombia — receipts sin IVA (recibos de caja no llevan IVA en la factura)
  {
    countryCode: "CO",
    name: "Recibo de caja CO — sin impuesto directo",
    trigger: { document_types: ["receipt"] },
    taxes: [],
    priority: 10,
  },
  // México — IVA 16% general
  {
    countryCode: "MX",
    name: "IVA México 16%",
    trigger: { document_types: ["invoice"] },
    taxes: [{ type: "IVA", rate: 0.16, base: "subtotal", ns_tax_code: "IVA_MX" }],
    priority: 10,
  },
  // México — ISR retención servicios profesionales 10%
  {
    countryCode: "MX",
    name: "ISR Retención Servicios Profesionales MX",
    trigger: {
      document_types: ["invoice"],
      vendor_regime: "professional_services",
    },
    taxes: [{ type: "ISR_RETENCION", rate: 0.10, base: "subtotal", ns_tax_code: "ISR_MX" }],
    priority: 20,
  },
];

// ── Condition evaluator (safe subset — no eval) ───────────────────────

function evaluateCondition(condition: string, subtotal: number): boolean {
  const m = condition.match(/^subtotal\s*(>=|>|<=|<|===|==)\s*(\d+(?:\.\d+)?)$/);
  if (!m) return true;
  const [, op, rawVal] = m;
  const val = parseFloat(rawVal);
  switch (op) {
    case ">=":  return subtotal >= val;
    case ">":   return subtotal >  val;
    case "<=":  return subtotal <= val;
    case "<":   return subtotal <  val;
    default:    return subtotal === val;
  }
}

// ── NIT validation (Colombia) ─────────────────────────────────────────

export function validateNitColombia(nit: string): boolean {
  const digits = nit.replace(/[^0-9]/g, "");
  if (digits.length < 2) return false;
  const body = digits.slice(0, -1);
  const dv   = parseInt(digits.slice(-1), 10);
  const weights = [71, 67, 59, 53, 47, 43, 41, 37, 29, 23, 19, 17, 13, 7, 3];
  const offset  = weights.length - body.length;
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    sum += parseInt(body[i], 10) * weights[offset + i];
  }
  const remainder = sum % 11;
  const expected  = remainder < 2 ? remainder : 11 - remainder;
  return dv === expected;
}

// ── RFC validation (México — basic format) ───────────────────────────

export function validateRfcMexico(rfc: string): boolean {
  const personaFisica  = /^[A-Z]{4}\d{6}[A-Z0-9]{3}$/;
  const personaMoral   = /^[A-Z]{3}\d{6}[A-Z0-9]{3}$/;
  const normalized     = rfc.toUpperCase().replace(/\s/g, "");
  return personaFisica.test(normalized) || personaMoral.test(normalized);
}

export function validateFiscalId(countryCode: string, id: string): boolean {
  switch (countryCode) {
    case "CO": return validateNitColombia(id);
    case "MX": return validateRfcMexico(id);
    default:   return id.trim().length > 0;
  }
}

// ── Main calculation function ─────────────────────────────────────────

export function calculateTaxes(input: TaxCalculationInput): TaxCalculationResult {
  const rules = (input.orgRules ?? DEFAULT_TAX_RULES)
    .filter(r => r.countryCode === input.countryCode && r.taxes.length > 0)
    .filter(r => {
      const t = r.trigger;
      if (t.document_types?.length && input.documentType) {
        if (!t.document_types.includes(input.documentType)) return false;
      }
      if (t.category_ids?.length && input.categoryId) {
        if (!t.category_ids.includes(input.categoryId)) return false;
      }
      if (t.amount_range) {
        if (input.subtotal < t.amount_range.min) return false;
        if (t.amount_range.max !== null && input.subtotal > t.amount_range.max) return false;
      }
      if (t.vendor_regime && input.vendorRegime) {
        if (t.vendor_regime !== input.vendorRegime) return false;
      }
      return true;
    })
    .sort((a, b) => a.priority - b.priority);

  const calculated: CalculatedTax[] = [];
  const seenTypes = new Set<string>();

  for (const rule of rules) {
    for (const tax of rule.taxes) {
      if (seenTypes.has(tax.type)) continue;
      const base = tax.base === "subtotal" ? input.subtotal : input.subtotal;
      if (tax.condition && !evaluateCondition(tax.condition, input.subtotal)) continue;
      const amount = parseFloat((base * tax.rate).toFixed(2));
      calculated.push({ type: tax.type, rate: tax.rate, base, amount, nsTaxCode: tax.ns_tax_code });
      seenTypes.add(tax.type);
    }
  }

  const retentionTypes = ["RETEFUENTE", "RETEICA", "ISR_RETENCION", "RETEIVA"];
  const totalTax       = calculated.filter(t => !retentionTypes.includes(t.type)).reduce((s, t) => s + t.amount, 0);
  const totalRetention = calculated.filter(t =>  retentionTypes.includes(t.type)).reduce((s, t) => s + t.amount, 0);
  const total          = parseFloat((input.subtotal + totalTax - totalRetention).toFixed(2));

  return { taxes: calculated, totalTax, totalRetention, total };
}
