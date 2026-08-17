// First-boot catalog seeder. On a fresh DB the `products` and `features` tables
// are empty, so the feature guard (isFeatureEnabled) throws "Unknown feature: …".
// This runs at server start (from instrumentation.ts), is idempotent, and only
// seeds the catalog + feature→product mapping — it does NOT touch org_products
// (per-org grants come from the client wizard, not from boot).
import { db } from "@/lib/db";
import { products, features } from "@/db/schema";
import { eq } from "drizzle-orm";
import { PRODUCTS, FEATURE_PRODUCT } from "@/lib/products/registry";
import { FEATURE_CATALOG } from "@/lib/features/catalog";

export async function seedCatalog(): Promise<void> {
  // 1) Product catalog
  for (const p of PRODUCTS) {
    await db.insert(products).values({
      key: p.key, name: p.name, description: p.description,
      icon: p.icon, requiresIntegration: p.requiresIntegration, sortOrder: p.sortOrder,
    }).onConflictDoUpdate({
      target: products.key,
      set: { name: p.name, description: p.description, icon: p.icon,
             requiresIntegration: p.requiresIntegration, sortOrder: p.sortOrder },
    });
  }

  // 2) Feature catalog
  for (const f of FEATURE_CATALOG) {
    await db.insert(features).values(f).onConflictDoUpdate({
      target: features.id,
      set: {
        name: f.name, description: f.description, category: f.category, defaultEnabled: f.defaultEnabled,
        featureType: f.featureType, defaultConfig: f.defaultConfig, configSchema: f.configSchema,
        planRequired: f.planRequired, isBeta: f.isBeta, sortOrder: f.sortOrder,
      },
    });
  }

  // 3) Map features → product (features not in the map stay platform-wide / null)
  for (const [featureId, productKey] of Object.entries(FEATURE_PRODUCT)) {
    await db.update(features).set({ productKey }).where(eq(features.id, featureId));
  }

  console.log(`[seed] catalog ready: ${PRODUCTS.length} products, ${FEATURE_CATALOG.length} features`);
}
