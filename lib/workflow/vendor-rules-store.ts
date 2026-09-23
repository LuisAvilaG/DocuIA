import { db } from "@/lib/db";
import { catalogVendors, subsidiaries, vendorRules } from "@/db/schema";
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { parseVendorRuleConfig, type VendorRuleConfig } from "./vendor-rules";

export type VendorRuleScope = "default" | "category" | "vendor";

export interface VendorRuleView {
  id: string;
  scope: VendorRuleScope;
  targetKey: string;
  targetLabel: string | null;
  config: VendorRuleConfig;
  updatedAt: string;
}

export interface VendorCategory {
  id: string;
  name: string;
  vendorCount: number;
}

export async function listVendorRules(organizationId: string): Promise<VendorRuleView[]> {
  const rows = await db.query.vendorRules.findMany({
    where: eq(vendorRules.organizationId, organizationId),
    orderBy: [asc(vendorRules.createdAt)],
  });
  const rank: Record<VendorRuleScope, number> = { default: 0, category: 1, vendor: 2 };
  return rows
    .map((r) => ({
      id: r.id,
      scope: r.scope,
      targetKey: r.targetKey,
      targetLabel: r.targetLabel,
      config: parseVendorRuleConfig(r.config),
      updatedAt: r.updatedAt.toISOString(),
    }))
    .sort((a, b) => rank[a.scope] - rank[b.scope] || (a.targetLabel ?? "").localeCompare(b.targetLabel ?? "", "es"));
}

/** Vendor categories seen in the synced ERP catalog, with how many vendors each has. */
export async function listVendorCategories(organizationId: string): Promise<VendorCategory[]> {
  const subs = await db.select({ id: subsidiaries.id }).from(subsidiaries).where(eq(subsidiaries.organizationId, organizationId));
  if (!subs.length) return [];
  const rows = await db
    .select({
      id: catalogVendors.categoryId,
      name: sql<string>`max(${catalogVendors.categoryName})`,
      vendorCount: sql<number>`count(distinct ${catalogVendors.internalId})::int`,
    })
    .from(catalogVendors)
    .where(and(inArray(catalogVendors.subsidiaryId, subs.map((s) => s.id)), isNotNull(catalogVendors.categoryId), eq(catalogVendors.isInactive, false)))
    .groupBy(catalogVendors.categoryId);
  return rows
    .filter((r): r is { id: string; name: string; vendorCount: number } => Boolean(r.id))
    .map((r) => ({ id: r.id, name: r.name || r.id, vendorCount: Number(r.vendorCount) || 0 }))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}
