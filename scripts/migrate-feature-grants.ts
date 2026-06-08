import "dotenv/config";
import { db } from "@/lib/db";
import { orgFeatures } from "@/db/schema";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";

async function main() {
  console.log("Migrating feature grants...");

  // For netsuite_dry_run: admin_granted = true for any existing row
  // (the admin had interacted with this feature, tenant controls is_enabled)
  await db
    .update(orgFeatures)
    .set({ adminGranted: true })
    .where(eq(orgFeatures.featureId, "netsuite_dry_run"));
  console.log(`  ✓ netsuite_dry_run: adminGranted = true for all existing rows`);

  // For all other features: admin_granted = is_enabled (preserve current effective state)
  await db.execute(
    sql`UPDATE org_features SET admin_granted = is_enabled WHERE feature_id != 'netsuite_dry_run'`
  );
  console.log(`  ✓ other features: adminGranted = isEnabled`);

  console.log("\nDone! Run db:push or db:generate + db:migrate to apply schema changes first.");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
