import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { orgProducts } from "@/db/schema";
import { and, eq, ne } from "drizzle-orm";

export * from "./registry";

// Product keys the org currently has (anything not explicitly disabled).
export async function getActiveProductKeys(orgId: string): Promise<Set<string>> {
  const rows = await db.query.orgProducts.findMany({
    where: and(eq(orgProducts.organizationId, orgId), ne(orgProducts.status, "disabled")),
    columns: { productKey: true },
  });
  return new Set(rows.map((r) => r.productKey));
}

export async function isProductActive(orgId: string, productKey: string): Promise<boolean> {
  const row = await db.query.orgProducts.findFirst({
    where: and(eq(orgProducts.organizationId, orgId), eq(orgProducts.productKey, productKey)),
    columns: { status: true },
  });
  return !!row && row.status !== "disabled";
}

export type TenantHomePath = "/dashboard" | "/contracts/dashboard" | "/accounting/expenses";

// Keep the tenant's first destination aligned with the products it actually
// owns. AP Automation remains the default for multi-product tenants so their
// existing navigation does not change; product-only tenants land in their own
// workspace instead of an empty AP dashboard.
export async function getTenantHomePath(orgId: string): Promise<TenantHomePath> {
  const activeProducts = await getActiveProductKeys(orgId);
  if (activeProducts.has("ap_automation")) return "/dashboard";
  if (activeProducts.has("contract_intelligence")) return "/contracts/dashboard";
  if (activeProducts.has("expense_management")) return "/accounting/expenses";
  return "/dashboard";
}

/**
 * Guard for AP Automation pages: a tenant without the product is sent to its
 * own product's home (or to /unavailable when it has none), instead of seeing
 * AP screens by typing the URL.
 */
export async function requireApAutomation(orgId: string): Promise<void> {
  if (await isProductActive(orgId, "ap_automation")) return;
  const home = await getTenantHomePath(orgId);
  redirect(home === "/dashboard" ? "/unavailable?reason=product" : home);
}
