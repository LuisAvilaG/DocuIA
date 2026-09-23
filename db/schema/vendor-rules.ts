import { pgTable, varchar, json, timestamp, pgEnum, uniqueIndex, index } from "drizzle-orm/pg-core";

// How an organization processes AP invoices per vendor. The most specific rule
// wins: vendor → vendor category (from the ERP) → the default rule.
export const vendorRuleScopeEnum = pgEnum("vendor_rule_scope", ["default", "category", "vendor"]);

export const vendorRules = pgTable("vendor_rules", {
  id:             varchar("id", { length: 36 }).primaryKey(),
  organizationId: varchar("organization_id", { length: 36 }).notNull(),
  scope:          vendorRuleScopeEnum("scope").notNull(),
  // Category or vendor internal id in the ERP; "*" for the default rule.
  targetKey:      varchar("target_key", { length: 64 }).notNull(),
  targetLabel:    varchar("target_label", { length: 255 }),
  // VendorRuleConfig (lib/workflow/vendor-rules.ts)
  config:         json("config").notNull(),
  createdBy:      varchar("created_by", { length: 36 }),
  createdAt:      timestamp("created_at").notNull().defaultNow(),
  updatedAt:      timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("vendor_rules_target_idx").on(t.organizationId, t.scope, t.targetKey),
  index("vendor_rules_org_idx").on(t.organizationId),
]);
