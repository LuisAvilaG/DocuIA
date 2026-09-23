export type TenantArea = "documents" | "contracts" | "expenses" | "settings" | "profile";
export interface TenantAccess { area?: TenantArea; permission?: "read" | "write" }

export const TENANT_ROLES = ["admin", "approver", "accountant", "operator", "viewer", "expense_submitter"] as const;
export type TenantRole = typeof TENANT_ROLES[number];

export const TENANT_ROLE_LABELS: Record<TenantRole, string> = {
  admin:             "Administrador",
  approver:          "Aprobador",
  accountant:        "Contabilidad",
  operator:          "Operador",
  viewer:            "Solo lectura",
  expense_submitter: "Empleado (gastos)",
};

export function isTenantRole(value: unknown): value is TenantRole {
  return typeof value === "string" && (TENANT_ROLES as readonly string[]).includes(value);
}

// Role matrix (admin can do everything):
// - approver:   operator on documents/contracts + approves in every product;
//               submits own expenses.
// - accountant: reviews, approves, syncs and exports expense reports; submits
//               own expenses; read-only on AP documents.
// - operator:   documents/contracts read+write.
// - viewer:     documents/contracts read-only.
// - expense_submitter: own expense reports only.
export function canAccessTenantArea(role: string, access: TenantAccess = {}, scopes: string[] = []): boolean {
  const area = access.area ?? "documents";
  const permission = access.permission ?? "read";
  if (role === "api_key") {
    return area === "documents" && scopes.includes(`${area}:${permission}`);
  }
  if (role === "admin") return true;
  if (!isTenantRole(role)) return false;
  if (area === "settings") return false;
  if (area === "profile") return true;
  switch (role) {
    case "approver":          return true;
    case "accountant":        return area === "expenses" || (area === "documents" && permission === "read");
    case "operator":          return area === "documents" || area === "contracts";
    case "viewer":            return permission === "read" && (area === "documents" || area === "contracts");
    case "expense_submitter": return area === "expenses";
    default:                  return false;
  }
}

export type ApprovalArea = "documents" | "contracts" | "expenses";

/** Who may give the final approval that posts or closes a record. */
export function canApprove(role: string, area: ApprovalArea): boolean {
  if (role === "admin" || role === "approver") return true;
  return role === "accountant" && area === "expenses";
}

/** Sees every expense report of the organization (accounting view). */
export function canReviewExpenses(role: string): boolean {
  return role === "admin" || role === "approver" || role === "accountant";
}

/** Posts expense reports to NetSuite and exports them. */
export function canSyncExpenses(role: string): boolean {
  return role === "admin" || role === "accountant";
}
