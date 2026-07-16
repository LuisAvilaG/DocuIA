/**
 * Seeds the product catalog, maps existing features to their product, and
 * backfills org_products for existing organizations so current access is
 * preserved under the à-la-carte model:
 *   - ap_automation      → every existing org (the platform was AP for everyone)
 *   - expense_management → orgs that have the expense_management feature granted
 * Idempotent: safe to run repeatedly.
 */
import "./_load-env"; // must be first — loads env before lib/db initializes the pool
import { db } from "../lib/db";
import { products, orgProducts, features, organizations, orgFeatures } from "../db/schema";
import { and, eq, sql } from "drizzle-orm";
import { PRODUCTS, FEATURE_PRODUCT } from "../lib/products/registry";

async function main() {
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
  console.log(`✓ ${PRODUCTS.length} productos en catálogo`);

  // 2) Map features → product (features not in the map stay platform-wide / null)
  let mapped = 0;
  for (const [featureId, productKey] of Object.entries(FEATURE_PRODUCT)) {
    const r = await db.update(features).set({ productKey }).where(eq(features.id, featureId));
    mapped += (r as unknown as { rowCount?: number }).rowCount ?? 0;
  }
  console.log(`✓ ${mapped} features asociadas a un producto`);

  // 3) Backfill org_products for existing orgs
  const orgs = await db.query.organizations.findMany({ columns: { id: true } });

  // Which orgs have expense_management granted (explicit grant OR feature default)
  const expenseFeature = await db.query.features.findFirst({ where: eq(features.id, "expense_management"), columns: { defaultEnabled: true } });
  const expenseDefaultOn = expenseFeature?.defaultEnabled ?? false;
  const expenseGrants = await db.query.orgFeatures.findMany({
    where: and(eq(orgFeatures.featureId, "expense_management"), eq(orgFeatures.adminGranted, true)),
    columns: { organizationId: true },
  });
  const expenseOrgs = new Set(expenseGrants.map((g) => g.organizationId));

  let apCount = 0, expCount = 0;
  for (const org of orgs) {
    // ap_automation for everyone (historical universal product)
    const ap = await db.insert(orgProducts)
      .values({ organizationId: org.id, productKey: "ap_automation", status: "active" })
      .onConflictDoNothing({ target: [orgProducts.organizationId, orgProducts.productKey] });
    apCount += (ap as unknown as { rowCount?: number }).rowCount ?? 0;

    if (expenseDefaultOn || expenseOrgs.has(org.id)) {
      const ex = await db.insert(orgProducts)
        .values({ organizationId: org.id, productKey: "expense_management", status: "active" })
        .onConflictDoNothing({ target: [orgProducts.organizationId, orgProducts.productKey] });
      expCount += (ex as unknown as { rowCount?: number }).rowCount ?? 0;
    }
  }
  console.log(`✓ backfill: ${orgs.length} orgs · +${apCount} ap_automation · +${expCount} expense_management`);

  console.log("\nSeed de productos completo.");
  process.exit(0);
}

main().catch((e) => { console.error("FAIL", e); process.exit(1); });
