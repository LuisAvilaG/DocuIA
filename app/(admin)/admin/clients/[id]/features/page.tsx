import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orgFeatures, orgProducts, subsidiaries } from "@/db/schema";
import { loadOneOrgFacts } from "@/lib/admin/health";
import { PRODUCTS, productForFeature } from "@/lib/products/registry";
import { PRESETS } from "@/lib/contracts/presets";
import { FeaturesView, type ProductState, type FeatureRow } from "./features-view";

const TENANT_CONTROLLED = new Set(["netsuite_dry_run"]);

export default async function ClientFeaturesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const facts = await loadOneOrgFacts(id);
  if (!facts) notFound();

  const [allFeatures, overrides, products, subs] = await Promise.all([
    db.query.features.findMany(),
    db.query.orgFeatures.findMany({ where: eq(orgFeatures.organizationId, id) }),
    db.query.orgProducts.findMany({ where: eq(orgProducts.organizationId, id) }),
    db.query.subsidiaries.findMany({ where: eq(subsidiaries.organizationId, id), columns: { id: true, name: true } }),
  ]);
  const overrideBy = new Map(overrides.map((o) => [o.featureId, o]));
  const productBy = new Map(products.map((p) => [p.productKey, p]));

  const rows: FeatureRow[] = allFeatures
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((f) => {
      const o = overrideBy.get(f.id);
      const adminGranted = o?.adminGranted ?? f.defaultEnabled;
      const tenantEnabled = o?.isEnabled ?? false;
      return {
        id: f.id, name: f.name, description: f.description, category: f.category,
        featureType: f.featureType, defaultConfig: (f.defaultConfig as Record<string, unknown> | null) ?? null,
        configSchema: f.configSchema as FeatureRow["configSchema"], planRequired: f.planRequired, isBeta: f.isBeta,
        adminGranted, tenantEnabled,
        isEnabled: TENANT_CONTROLLED.has(f.id) ? adminGranted && tenantEnabled : adminGranted,
        config: { ...((f.defaultConfig as Record<string, unknown>) ?? {}), ...((o?.configJson as Record<string, unknown>) ?? {}) },
        notes: o?.notes ?? null, enabledBy: o?.enabledBy ?? null,
        product: productForFeature(f.id),
        hasOverride: Boolean(o),
      };
    });

  const productStates: ProductState[] = PRODUCTS.map((p) => {
    const row = productBy.get(p.key);
    const cfg = (row?.configJson as Record<string, unknown> | null) ?? null;
    return {
      key: p.key, name: p.name, description: p.description, requiresIntegration: p.requiresIntegration,
      status: row?.status ?? "disabled", contracted: Boolean(row) && row!.status !== "disabled",
      enabledAt: row?.enabledAt?.toISOString() ?? null,
      maxFlows: typeof cfg?.maxFlows === "number" ? cfg.maxFlows : 3,
      playbook: typeof cfg?.playbook === "string" ? cfg.playbook : Object.values(PRESETS)[0]?.key ?? "",
    };
  });

  const activeConn = facts.connections.find((c) => c.environment === facts.activeNsEnvironment);
  const erpConnected = activeConn?.status === "connected";

  return (
    <FeaturesView
      orgId={id}
      erpConnected={erpConnected}
      products={productStates}
      features={rows}
      subsidiaries={subs}
      playbooks={Object.values(PRESETS).map((p) => ({ key: p.key, name: p.name }))}
    />
  );
}
