export type TenantArea = "documents" | "contracts" | "expenses" | "settings" | "profile";
export interface TenantAccess { area?: TenantArea; permission?: "read" | "write" }

export function canAccessTenantArea(role: string, access: TenantAccess = {}, scopes: string[] = []): boolean {
  const area = access.area ?? "documents";
  const permission = access.permission ?? "read";
  if (role === "api_key") {
    return area === "documents" && scopes.includes(`${area}:${permission}`);
  }
  if (role === "admin") return true;
  if (area === "settings") return false;
  if (area === "profile") return ["operator", "viewer", "expense_submitter"].includes(role);
  if (role === "expense_submitter") return area === "expenses";
  if (role === "viewer") return permission === "read" && area !== "expenses";
  return role === "operator" && area !== "expenses";
}

export type ApprovalArea = "documents" | "contracts" | "expenses";

/** Who may give the final approval that posts or closes a record. */
export function canApprove(role: string, area: ApprovalArea): boolean {
  void area;
  return role === "admin";
}
