import { withApiSecurity } from "@/lib/security/http";
import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/admin";
import { db } from "@/lib/db";
import { features, orgFeatures, orgProducts, organizations } from "@/db/schema";
import { and, asc, eq, isNull, sql } from "drizzle-orm";

/** Catalog with, per feature, how many clients have it on and how many set their own value. */
async function handleGET() {
  const { error } = await requireAdminSession();
  if (error) return error;

  try {
    const [rows, overrides, productCounts, orgCount] = await Promise.all([
      db.select().from(features).orderBy(asc(features.sortOrder), asc(features.name)),
      db.select({
        featureId: orgFeatures.featureId,
        overrides: sql<number>`count(*)::int`,
        granted: sql<number>`count(*) filter (where ${orgFeatures.adminGranted})::int`,
      }).from(orgFeatures).innerJoin(organizations, and(eq(organizations.id, orgFeatures.organizationId), isNull(organizations.deletedAt)))
        .groupBy(orgFeatures.featureId),
      db.select({ productKey: orgProducts.productKey, n: sql<number>`count(distinct ${orgProducts.organizationId})::int` })
        .from(orgProducts).innerJoin(organizations, and(eq(organizations.id, orgProducts.organizationId), isNull(organizations.deletedAt)))
        .where(sql`${orgProducts.status} <> 'disabled'`).groupBy(orgProducts.productKey),
      db.select({ n: sql<number>`count(*)::int` }).from(organizations).where(isNull(organizations.deletedAt)),
    ]);
    const ovBy = new Map(overrides.map((o) => [o.featureId, o]));
    const prodBy = new Map(productCounts.map((p) => [p.productKey, Number(p.n)]));
    const total = Number(orgCount[0]?.n ?? 0);
    return NextResponse.json({
      total,
      productClients: Object.fromEntries(prodBy),
      features: rows.map((f) => {
        const ov = ovBy.get(f.id);
        const eligible = f.productKey ? (prodBy.get(f.productKey) ?? 0) : total;
        const overrides = Number(ov?.overrides ?? 0);
        const granted = Number(ov?.granted ?? 0);
        // Clients without an override follow the default.
        const active = granted + (f.defaultEnabled ? Math.max(0, eligible - overrides) : 0);
        return { ...f, stats: { eligible, overrides, active } };
      }),
    });
  } catch (err) {
    console.error("[admin/features GET]", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

export const GET = withApiSecurity(handleGET);
