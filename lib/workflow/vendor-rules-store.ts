import { db } from "@/lib/db";
import { catalogVendors, historyDocuments, subsidiaries, vendorRules } from "@/db/schema";
import { and, asc, eq, gte, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { parseVendorRuleConfig, resolveVendorRule, type VendorRuleConfig } from "./vendor-rules";

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

export interface RuleUsage { vendors: number; invoices: number }

/** Inicio del trimestre calendario de `now`. */
function quarterStart(now = new Date()): Date {
  return new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
}

/**
 * Cuántos proveedores del catálogo y cuántas facturas del trimestre caen en cada
 * regla, resolviendo con la misma prioridad que el envío (proveedor → categoría →
 * predeterminada). La clave `general` cuenta lo que no tiene regla.
 */
export async function ruleUsage(organizationId: string, now = new Date()): Promise<Record<string, RuleUsage>> {
  const subs = await db.select({ id: subsidiaries.id }).from(subsidiaries).where(eq(subsidiaries.organizationId, organizationId));
  if (!subs.length) return {};
  const vendorIdExpr = sql<string | null>`coalesce(${historyDocuments.products}->'approval_draft'->>'vendorId', ${historyDocuments.products}->'document'->'vendor'->>'selected_internal_id')`;
  const [rules, vendors, invoices] = await Promise.all([
    db.query.vendorRules.findMany({ where: eq(vendorRules.organizationId, organizationId) }),
    db.select({ internalId: catalogVendors.internalId, name: catalogVendors.name, categoryId: catalogVendors.categoryId })
      .from(catalogVendors).where(and(inArray(catalogVendors.subsidiaryId, subs.map((s) => s.id)), eq(catalogVendors.isInactive, false))),
    db.select({ vendorId: vendorIdExpr, vendor: historyDocuments.vendor, n: sql<number>`count(*)::int` })
      .from(historyDocuments)
      .where(and(eq(historyDocuments.organizationId, organizationId), ne(historyDocuments.documentType, "purchase_order"), gte(historyDocuments.createdAt, quarterStart(now))))
      .groupBy(vendorIdExpr, historyDocuments.vendor),
  ]);
  const categoryOf = new Map<string, string | null>();
  const idByName = new Map<string, string>();
  for (const v of vendors) {
    if (!categoryOf.has(v.internalId)) categoryOf.set(v.internalId, v.categoryId);
    if (v.name) idByName.set(v.name.trim().toLowerCase(), v.internalId);
  }
  const ruleOf = (internalId: string | null) => {
    const r = resolveVendorRule(rules, { internalId, categoryId: internalId ? categoryOf.get(internalId) ?? null : null }, parseVendorRuleConfig({}));
    return r.ruleId ?? "general";
  };
  const out: Record<string, RuleUsage> = {};
  const bump = (key: string, field: keyof RuleUsage, n: number) => {
    out[key] ??= { vendors: 0, invoices: 0 };
    out[key][field] += n;
  };
  for (const id of categoryOf.keys()) bump(ruleOf(id), "vendors", 1);
  for (const row of invoices) {
    const id = row.vendorId ?? (row.vendor ? idByName.get(row.vendor.trim().toLowerCase()) ?? null : null);
    bump(ruleOf(id), "invoices", Number(row.n) || 0);
  }
  return out;
}

/** Qué regla se aplica a un proveedor del catálogo y por qué. */
export async function ruleForVendor(organizationId: string, vendorId: string): Promise<{ ruleId: string | null; label: string; via: "vendor" | "category" | "default" | "general"; categoryName: string | null }> {
  const subs = await db.select({ id: subsidiaries.id }).from(subsidiaries).where(eq(subsidiaries.organizationId, organizationId));
  const [rules, vendor] = await Promise.all([
    db.query.vendorRules.findMany({ where: eq(vendorRules.organizationId, organizationId) }),
    subs.length
      ? db.query.catalogVendors.findFirst({ where: and(inArray(catalogVendors.subsidiaryId, subs.map((s) => s.id)), eq(catalogVendors.internalId, vendorId)), columns: { categoryId: true, categoryName: true } })
      : Promise.resolve(undefined),
  ]);
  const r = resolveVendorRule(rules, { internalId: vendorId, categoryId: vendor?.categoryId ?? null }, parseVendorRuleConfig({}));
  const picked = rules.find((x) => x.id === r.ruleId);
  return {
    ruleId: r.ruleId,
    label: picked ? (picked.scope === "default" ? "Predeterminada" : picked.targetLabel ?? picked.targetKey) : "Configuración general",
    via: picked ? picked.scope : "general",
    categoryName: vendor?.categoryName ?? null,
  };
}
