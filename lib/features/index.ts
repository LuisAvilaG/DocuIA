import { db } from "@/lib/db";
import { features, orgFeatures } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { productForFeature, getActiveProductKeys } from "@/lib/products";

export type FeatureConfig = Record<string, unknown>;

// Features where the tenant controls the on/off state (admin only grants access)
const TENANT_CONTROLLED = new Set(["netsuite_dry_run"]);

export interface ResolvedFeature {
  id: string;
  adminGranted: boolean;   // admin has granted this feature to the org
  tenantEnabled: boolean;  // tenant's raw on/off choice (only used for TENANT_CONTROLLED features)
  isEnabled: boolean;      // effective: adminGranted for admin-controlled, adminGranted && tenantEnabled for tenant-controlled
  config: FeatureConfig;
}

export async function getFeature(organizationId: string, featureId: string): Promise<ResolvedFeature> {
  const [feature, override, activeProducts] = await Promise.all([
    db.query.features.findFirst({ where: eq(features.id, featureId) }),
    db.query.orgFeatures.findFirst({
      where: and(eq(orgFeatures.organizationId, organizationId), eq(orgFeatures.featureId, featureId)),
    }),
    getActiveProductKeys(organizationId),
  ]);
  if (!feature) throw new Error(`Unknown feature: ${featureId}`);

  const defaultConfig = (feature.defaultConfig ?? {}) as FeatureConfig;
  const overrideConfig = (override?.configJson ?? {}) as FeatureConfig;

  const adminGranted = override?.adminGranted ?? feature.defaultEnabled;
  const tenantEnabled = override?.isEnabled ?? false;
  // Product gate: a feature belonging to a product is only usable if the org has
  // that product active. Platform features (null) are always allowed.
  const product = productForFeature(featureId);
  const productActive = product === null || activeProducts.has(product);
  const base = TENANT_CONTROLLED.has(featureId) ? adminGranted && tenantEnabled : adminGranted;
  const isEnabled = productActive && base;

  return {
    id: featureId,
    adminGranted,
    tenantEnabled,
    isEnabled,
    config: { ...defaultConfig, ...overrideConfig },
  };
}

export async function getAllFeatures(organizationId: string): Promise<ResolvedFeature[]> {
  const [allFeatures, allOverrides, activeProducts] = await Promise.all([
    db.query.features.findMany(),
    db.query.orgFeatures.findMany({ where: eq(orgFeatures.organizationId, organizationId) }),
    getActiveProductKeys(organizationId),
  ]);

  const overrideMap = new Map(allOverrides.map((o) => [o.featureId, o]));

  return allFeatures.map((f) => {
    const override = overrideMap.get(f.id);
    const defaultConfig = (f.defaultConfig ?? {}) as FeatureConfig;
    const overrideConfig = (override?.configJson ?? {}) as FeatureConfig;

    const adminGranted = override?.adminGranted ?? f.defaultEnabled;
    const tenantEnabled = override?.isEnabled ?? false;
    const product = productForFeature(f.id);
    const productActive = product === null || activeProducts.has(product);
    const base = TENANT_CONTROLLED.has(f.id) ? adminGranted && tenantEnabled : adminGranted;
    const isEnabled = productActive && base;

    return {
      id: f.id,
      adminGranted,
      tenantEnabled,
      isEnabled,
      config: { ...defaultConfig, ...overrideConfig },
    };
  });
}

/** Admin sets grant access for an org feature. Does NOT touch tenantEnabled. */
export async function setAdminGrant(
  organizationId: string,
  featureId: string,
  granted: boolean,
  configJson?: FeatureConfig,
  adminId?: string,
  notes?: string
): Promise<void> {
  await db
    .insert(orgFeatures)
    .values({
      organizationId,
      featureId,
      adminGranted: granted,
      isEnabled: false,
      configJson: configJson ?? null,
      enabledBy: adminId ?? null,
      notes: notes ?? null,
    })
    .onConflictDoUpdate({
      target: [orgFeatures.organizationId, orgFeatures.featureId],
      set: {
        adminGranted: granted,
        // When revoking access, also force-disable tenant choice so it can't stay "stuck"
        ...(granted === false ? { isEnabled: false } : {}),
        configJson: configJson ?? null,
        enabledBy: adminId ?? null,
        notes: notes ?? null,
        updatedAt: new Date(),
      },
    });
}

/** Tenant sets their own on/off choice for a tenant-controlled feature. Does NOT touch adminGranted. */
export async function setTenantEnabled(
  organizationId: string,
  featureId: string,
  enabled: boolean,
  userId?: string
): Promise<void> {
  // Plain UPDATE only — the admin grant always creates the row first via setAdminGrant.
  // Avoids creating a row with adminGranted: false if somehow called without a prior grant.
  await db
    .update(orgFeatures)
    .set({
      isEnabled: enabled,
      enabledBy: userId ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(orgFeatures.organizationId, organizationId), eq(orgFeatures.featureId, featureId)));
}

export async function isFeatureEnabled(organizationId: string, featureId: string): Promise<boolean> {
  const f = await getFeature(organizationId, featureId);
  return f.isEnabled;
}
