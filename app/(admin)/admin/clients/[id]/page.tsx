import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import {
  organizations, subscriptions,
  features, orgFeatures, orgUsers,
  subsidiaries, usageDaily,
  catalogItems, catalogVendors, catalogLocations,
} from "@/db/schema";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { ClientDetailContent, type FullFeature, type OrgSummary, type SubsidiaryRow } from "./client";

async function getClientData(id: string): Promise<{ org: OrgSummary; allFeatures: FullFeature[]; subsidiaryRows: SubsidiaryRow[] } | null> {
  try {
    const monthStart = new Date().toISOString().slice(0, 7) + "-01";

    const [
      org,
      subscription,
      subRows,
      overrides,
      allFeatureRows,
      [usersRow],
      [docsRow],
    ] = await Promise.all([
      db.query.organizations.findFirst({ where: eq(organizations.id, id) }),
      db.query.subscriptions.findFirst({ where: eq(subscriptions.organizationId, id) }),
      db.query.subsidiaries.findMany({ where: eq(subsidiaries.organizationId, id) }),
      db.query.orgFeatures.findMany({ where: eq(orgFeatures.organizationId, id) }),
      db.query.features.findMany(),
      db.select({ count: sql<number>`count(*)::int` }).from(orgUsers).where(eq(orgUsers.organizationId, id)),
      db.select({ total: sql<number>`coalesce(sum(${usageDaily.docsProcessed}), 0)::int` })
        .from(usageDaily)
        .where(and(eq(usageDaily.organizationId, id), gte(usageDaily.date, monthStart))),
    ]);

    if (!org) return null;

    // Catalog counts per subsidiary
    const subIds = subRows.map(s => s.id);
    const [itemCounts, vendorCounts, locationCounts] = subIds.length
      ? await Promise.all([
          db.select({ subsidiaryId: catalogItems.subsidiaryId, count: sql<number>`count(*)::int` })
            .from(catalogItems).where(inArray(catalogItems.subsidiaryId, subIds)).groupBy(catalogItems.subsidiaryId),
          db.select({ subsidiaryId: catalogVendors.subsidiaryId, count: sql<number>`count(*)::int` })
            .from(catalogVendors).where(inArray(catalogVendors.subsidiaryId, subIds)).groupBy(catalogVendors.subsidiaryId),
          db.select({ subsidiaryId: catalogLocations.subsidiaryId, count: sql<number>`count(*)::int` })
            .from(catalogLocations).where(inArray(catalogLocations.subsidiaryId, subIds)).groupBy(catalogLocations.subsidiaryId),
        ])
      : [[], [], []];

    const itemMap = new Map(itemCounts.map(r => [r.subsidiaryId, r.count]));
    const vendorMap = new Map(vendorCounts.map(r => [r.subsidiaryId, r.count]));
    const locationMap = new Map(locationCounts.map(r => [r.subsidiaryId, r.count]));

    const subsidiaryRows: SubsidiaryRow[] = subRows.map(s => ({
      id:             s.id,
      name:           s.name,
      nsSubsidiaryId: s.nsSubsidiaryId,
      currency:       s.currency,
      isActive:       s.isActive,
      updatedAt:      s.updatedAt,
      itemCount:      itemMap.get(s.id) ?? 0,
      vendorCount:    vendorMap.get(s.id) ?? 0,
      locationCount:  locationMap.get(s.id) ?? 0,
    }));

    const overrideMap = new Map(overrides.map(o => [o.featureId, o]));

    const mergedFeatures: FullFeature[] = allFeatureRows.map(f => {
      const override = overrideMap.get(f.id);
      const adminGranted = override?.adminGranted ?? f.defaultEnabled;
      const tenantEnabled = override?.isEnabled ?? false;
      const isEnabled = f.id === "netsuite_dry_run"
        ? adminGranted && tenantEnabled
        : adminGranted;
      return {
        id:            f.id,
        name:          f.name,
        description:   f.description,
        category:      f.category,
        featureType:   f.featureType,
        defaultConfig: (f.defaultConfig as Record<string, unknown>) ?? null,
        configSchema:  f.configSchema,
        planRequired:  f.planRequired,
        isBeta:        f.isBeta,
        sortOrder:     f.sortOrder,
        adminGranted,
        tenantEnabled,
        isEnabled,
        config: {
          ...((f.defaultConfig as Record<string, unknown>) ?? {}),
          ...((override?.configJson as Record<string, unknown>) ?? {}),
        },
        notes:     override?.notes ?? null,
        enabledBy: override?.enabledBy ?? null,
      };
    });

    const docsThisMonth  = Number(docsRow?.total ?? 0);
    const usersCount     = Number(usersRow?.count ?? 0);
    const subsCount      = subRows.length;
    let healthScore = 0;
    if (usersCount > 0)    healthScore += 20;
    if (subsCount > 0)     healthScore += 20;
    if (docsThisMonth > 0) healthScore += 30;
    if (docsThisMonth >= 20)  healthScore += 15;
    if (docsThisMonth >= 100) healthScore += 15;

    const orgData: OrgSummary = {
      id:                org.id,
      name:              org.name,
      plan:              (subscription?.planId ?? "starter") as OrgSummary["plan"],
      status:            org.status,
      healthScore,
      docsThisMonth,
      usersCount,
      subsidiariesCount: subsCount,
    };

    return { org: orgData, allFeatures: mergedFeatures, subsidiaryRows };
  } catch (err) {
    console.error("[client-detail] DB error:", err);
    return null;
  }
}

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getClientData(id);
  if (!data) notFound();

  return <ClientDetailContent org={data.org} features={data.allFeatures} subsidiaries={data.subsidiaryRows} />;
}
