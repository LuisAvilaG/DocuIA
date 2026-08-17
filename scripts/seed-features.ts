/**
 * Seed the features catalog.
 * Run: npx tsx scripts/seed-features.ts
 * Catalog lives in lib/features/catalog.ts (shared with the runtime seeder).
 */
import "dotenv/config";
import { db } from "@/lib/db";
import { features } from "@/db/schema";
import { FEATURE_CATALOG } from "@/lib/features/catalog";

async function main() {
  for (const f of FEATURE_CATALOG) {
    await db.insert(features).values(f).onConflictDoUpdate({
      target: features.id,
      set: {
        name: f.name, description: f.description, category: f.category, defaultEnabled: f.defaultEnabled,
        featureType: f.featureType, defaultConfig: f.defaultConfig, configSchema: f.configSchema,
        planRequired: f.planRequired, isBeta: f.isBeta, sortOrder: f.sortOrder,
      },
    });
    console.log(`  ✓ ${f.id}`);
  }
  console.log(`\nDone! ${FEATURE_CATALOG.length} features seeded.`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
