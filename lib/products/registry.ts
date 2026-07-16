// Single source of truth for the product catalog and which features belong to
// which product. Consumed by the feature guard, the seed script and (later) the
// navigation. Keep in sync with db/schema/products.ts + seed-products.ts.

export type ProductKey = "ap_automation" | "expense_management" | "contract_intelligence";

export interface ProductDef {
  key:                 ProductKey;
  name:                string;
  description:         string;
  icon:                string;          // lucide icon name (used by UI)
  requiresIntegration: boolean;         // needs NetSuite (or similar) at onboarding
  sortOrder:           number;
}

export const PRODUCTS: ProductDef[] = [
  {
    key: "ap_automation",
    name: "AP Automation",
    description: "Procesamiento de facturas y órdenes de compra con IA y sincronización a NetSuite.",
    icon: "FileText",
    requiresIntegration: true,
    sortOrder: 10,
  },
  {
    key: "expense_management",
    name: "Expense Management",
    description: "Captura y aprobación de gastos de empleados con sincronización a NetSuite.",
    icon: "Receipt",
    requiresIntegration: true,
    sortOrder: 20,
  },
  {
    key: "contract_intelligence",
    name: "Contract Intelligence",
    description: "Análisis, validación cruzada y generación documental con IA. Sin integración requerida.",
    icon: "ScrollText",
    requiresIntegration: false,
    sortOrder: 30,
  },
];

// featureId → product it belongs to. Features NOT listed here are platform-wide
// (product_key = null) and are always available (subject to admin grant).
export const FEATURE_PRODUCT: Record<string, ProductKey> = {
  // AP Automation
  ai_tiered_fallback:     "ap_automation",
  ai_force_secondary:     "ap_automation",
  ai_model_selection:     "ap_automation",
  ai_validation_thresholds: "ap_automation",
  auto_mapping:           "ap_automation",
  po_processing:          "ap_automation",
  netsuite_dry_run:       "ap_automation",
  approval_workflow:      "ap_automation",
  duplicate_detection:    "ap_automation",
  bulk_upload:            "ap_automation",
  exception_queue:        "ap_automation",
  custom_netsuite_forms:  "ap_automation",
  auto_sync:              "ap_automation",
  sync_advanced:          "ap_automation",
  // Expense Management
  expense_management:      "expense_management",
  expense_approval:        "expense_management",
  expense_categories_sync: "expense_management",
  // contract_intelligence features are added in P9+
};

// Platform features (product_key = null): webhook_system, api_keys,
// scheduled_reports, advanced_analytics, data_export, data_retention,
// document_storage, ip_allowlist, tenant_audit_log, white_label.

export function productForFeature(featureId: string): ProductKey | null {
  return FEATURE_PRODUCT[featureId] ?? null;
}

// ── Navigation modules per product (consumed by the tenant sidebar) ──
export interface NavModule {
  href:       string;
  label:      string;
  icon:       string;    // lucide icon name (mapped to a component in the sidebar)
  feature?:   string;    // only shown if this feature is enabled
  adminOnly?: boolean;   // only shown to org admins
}

export const PRODUCT_MODULES: Record<ProductKey, NavModule[]> = {
  ap_automation: [
    { href: "/dashboard",   label: "Dashboard",    icon: "LayoutDashboard" },
    { href: "/workflow",    label: "Workflow",     icon: "FileUp" },
    { href: "/history",     label: "Historial",    icon: "Clock" },
    { href: "/exceptions",  label: "Excepciones",  icon: "AlertTriangle", feature: "exception_queue" },
    { href: "/mappings",    label: "Mapeos",       icon: "GitMerge",      feature: "auto_mapping" },
    { href: "/catalogs",    label: "Catálogos",    icon: "Database" },
    { href: "/statistics",  label: "Estadísticas", icon: "BarChart3",     feature: "advanced_analytics" },
  ],
  expense_management: [
    { href: "/accounting/expenses", label: "Gastos", icon: "Receipt", feature: "expense_management", adminOnly: true },
  ],
  contract_intelligence: [
    { href: "/contracts/dashboard",  label: "Panel",         icon: "LayoutDashboard" },
    { href: "/contracts",            label: "Casos",         icon: "ScrollText" },
    { href: "/contracts/approvals",  label: "Aprobaciones",  icon: "ClipboardCheck", adminOnly: true },
    { href: "/contracts/metrics",    label: "Métricas",      icon: "BarChart3" },
    { href: "/contracts/flow",       label: "Configuración", icon: "Workflow", adminOnly: true },
  ],
};

// Always-visible platform modules (not tied to a product).
export const PLATFORM_MODULES: NavModule[] = [
  { href: "/settings", label: "Configuración", icon: "Settings" },
];
