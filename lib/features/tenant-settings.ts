import { db } from "@/lib/db";
import { features, orgFeatures } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getFeature, type FeatureConfig } from "@/lib/features";
import { TENANT_OFF_KEY, tenantCanToggle, tenantEditableKeys, validateTenantConfig, type SchemaParam } from "./tenant-editable";

export type TenantSettingResult =
  | { ok: true; before: FeatureConfig; after: FeatureConfig; enabled: boolean }
  | { ok: false; status: number; error: string };

/**
 * Cambio que hace el administrador del cliente sobre una feature: encenderla o
 * apagarla (si se lo permite el mapa de editables) y los campos marcados como suyos.
 * Nunca cambia la concesión del superadmin ni los campos técnicos.
 */
export async function setTenantFeature(
  organizationId: string,
  featureId: string,
  change: { enabled?: boolean; config?: Record<string, unknown> },
  userId: string,
): Promise<TenantSettingResult> {
  if (change.enabled !== undefined && !tenantCanToggle(featureId)) {
    return { ok: false, status: 403, error: "Esta función la enciende o apaga DocuIA." };
  }
  if (change.config && Object.keys(change.config).length > 0 && tenantEditableKeys(featureId).length === 0) {
    return { ok: false, status: 403, error: "Esta configuración la ajusta DocuIA." };
  }

  const [def, current, row] = await Promise.all([
    db.query.features.findFirst({ where: eq(features.id, featureId), columns: { configSchema: true, defaultEnabled: true } }),
    getFeature(organizationId, featureId).catch(() => null),
    db.query.orgFeatures.findFirst({
      where: and(eq(orgFeatures.organizationId, organizationId), eq(orgFeatures.featureId, featureId)),
      columns: { configJson: true },
    }),
  ]);
  if (!def || !current) return { ok: false, status: 404, error: "Función no encontrada." };
  if (!current.adminGranted) return { ok: false, status: 403, error: "Esta función no está contratada." };

  let patch: FeatureConfig = {};
  if (change.config) {
    const v = validateTenantConfig(featureId, def.configSchema as SchemaParam[] | null, change.config);
    if (!v.ok) return { ok: false, status: 400, error: v.error };
    patch = v.config;
  }
  if (change.enabled !== undefined) patch[TENANT_OFF_KEY] = !change.enabled;

  const before = (row?.configJson ?? {}) as FeatureConfig;
  const after: FeatureConfig = { ...before, ...patch };
  if (row) {
    await db.update(orgFeatures)
      .set({ configJson: after, enabledBy: userId, updatedAt: new Date() })
      .where(and(eq(orgFeatures.organizationId, organizationId), eq(orgFeatures.featureId, featureId)));
  } else {
    // Sin fila propia la concesión es la predeterminada: se conserva tal cual.
    await db.insert(orgFeatures).values({
      organizationId, featureId, adminGranted: def.defaultEnabled, isEnabled: false, configJson: after, enabledBy: userId,
    });
  }
  return { ok: true, before, after, enabled: after[TENANT_OFF_KEY] !== true };
}
