/**
 * Seed default tax rules for expense management.
 * These are global rules (organizationId = null) — apply to all orgs
 * unless the org has its own rules for the same country.
 * Run: npx tsx scripts/seed-expense-rules.ts
 *
 * Note: the app does not read this table yet (the tax engine uses
 * DEFAULT_TAX_RULES from code); seeding it changes nothing a user sees.
 */
import "./_load-env"; // must be first: loads .env.local before lib/db reads env
import { db } from "@/lib/db";
import { expenseTaxRules } from "@/db/schema";
import { DEFAULT_TAX_RULES } from "@/lib/expense/tax-engine";
import { and, eq, isNull } from "drizzle-orm";

async function main() {
  console.log("Seeding expense tax rules...");

  for (const rule of DEFAULT_TAX_RULES) {
    // The table has no unique index, so "on conflict do nothing" never found a
    // conflict and every run added the whole set again.
    const existing = await db.query.expenseTaxRules.findFirst({
      where: and(isNull(expenseTaxRules.organizationId), eq(expenseTaxRules.countryCode, rule.countryCode), eq(expenseTaxRules.name, rule.name)),
      columns: { id: true },
    });
    if (existing) { console.log(`  = [${rule.countryCode}] ${rule.name} (ya existe)`); continue; }
    await db
      .insert(expenseTaxRules)
      .values({
        organizationId: null,
        countryCode:    rule.countryCode,
        name:           rule.name,
        triggerJson:    rule.trigger,
        taxesJson:      rule.taxes,
        priority:       rule.priority,
        isActive:       true,
      })
      .onConflictDoNothing();
    console.log(`  ✓ [${rule.countryCode}] ${rule.name}`);
  }

  console.log(`\nDone! ${DEFAULT_TAX_RULES.length} rules seeded.`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
