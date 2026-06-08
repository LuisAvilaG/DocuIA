/**
 * Seed default tax rules for expense management.
 * These are global rules (organizationId = null) — apply to all orgs
 * unless the org has its own rules for the same country.
 * Run: npx tsx scripts/seed-expense-rules.ts
 */
import "dotenv/config";
import { db } from "@/lib/db";
import { expenseTaxRules } from "@/db/schema";
import { DEFAULT_TAX_RULES } from "@/lib/expense/tax-engine";
import { randomUUID } from "crypto";

async function main() {
  console.log("Seeding expense tax rules...");

  for (const rule of DEFAULT_TAX_RULES) {
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
