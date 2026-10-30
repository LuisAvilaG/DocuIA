import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/admin";
import { logAdminAction } from "@/lib/audit/admin";
import { db } from "@/lib/db";
import { features, orgFeatures, organizations, orgProducts } from "@/db/schema";
import { and, eq, isNull, notInArray, sql } from "drizzle-orm";
import { productForFeature } from "@/lib/products/registry";

type Params = { params: Promise<{ id: string }> };

/** Clients that follow the default (no override of their own) and have the product. */
async function impact(featureId: string): Promise<{ affected: number; overrides: number; withProduct: number }> {
  const product = productForFeature(featureId);
  const overrideRows = await db.select({ organizationId: orgFeatures.organizationId }).from(orgFeatures).where(eq(orgFeatures.featureId, featureId));
  const overrideIds = overrideRows.map((r) => r.organizationId);
  const base = and(
    isNull(organizations.deletedAt),
    overrideIds.length ? notInArray(organizations.id, overrideIds) : undefined,
  );
  const [row] = product
    ? await db.select({ n: sql<number>`count(distinct ${organizations.id})::int` }).from(organizations)
        .innerJoin(orgProducts, and(eq(orgProducts.organizationId, organizations.id), eq(orgProducts.productKey, product), sql`${orgProducts.status} <> 'disabled'`))
        .where(base)
    : await db.select({ n: sql<number>`count(*)::int` }).from(organizations).where(base);
  const [withProduct] = product
    ? await db.select({ n: sql<number>`count(distinct ${orgProducts.organizationId})::int` }).from(orgProducts).where(and(eq(orgProducts.productKey, product), sql`${orgProducts.status} <> 'disabled'`))
    : await db.select({ n: sql<number>`count(*)::int` }).from(organizations).where(isNull(organizations.deletedAt));
  return { affected: Number(row?.n ?? 0), overrides: overrideIds.length, withProduct: Number(withProduct?.n ?? 0) };
}

async function handleGET(_req: NextRequest, { params }: Params) {
  const { error } = await requireAdminSession();
  if (error) return error;
  const { id } = await params;
  const feature = await db.query.features.findFirst({ where: eq(features.id, id) });
  if (!feature) return NextResponse.json({ error: "Feature no encontrada" }, { status: 404 });
  return NextResponse.json({ feature, impact: await impact(id) });
}

async function handlePATCH(req: NextRequest, { params }: Params) {
  const { error, session } = await requireAdminSession();
  if (error) return error;

  const { id } = await params;
  try {
    const body = await req.json() as { defaultEnabled?: boolean };
    if (typeof body.defaultEnabled !== "boolean") {
      return NextResponse.json({ error: "defaultEnabled requerido" }, { status: 400 });
    }
    const feature = await db.query.features.findFirst({ where: eq(features.id, id) });
    if (!feature) return NextResponse.json({ error: "Feature no encontrada" }, { status: 404 });
    const before = feature.defaultEnabled;
    const { affected } = await impact(id);
    await db.update(features).set({ defaultEnabled: body.defaultEnabled }).where(eq(features.id, id));
    await logAdminAction(req, session!, {
      action: "feature_default.updated", targetFeature: id,
      before: { defaultEnabled: before }, after: { defaultEnabled: body.defaultEnabled, affected },
    });
    return NextResponse.json({ ok: true, affected });
  } catch (err) {
    console.error("[admin/features PATCH]", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

export const GET = withApiSecurity(handleGET);
export const PATCH = withApiSecurity(handlePATCH);
