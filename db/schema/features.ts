import {
  pgTable, varchar, text, boolean, integer, json,
  smallint, timestamp, pgEnum, uniqueIndex, index,
} from "drizzle-orm/pg-core";

export const featureCategoryEnum = pgEnum("feature_category", [
  "extraction", "mapping", "workflow", "sync",
  "integration", "analytics", "security", "enterprise", "storage", "expenses",
]);

export const featureTypeEnum = pgEnum("feature_type", [
  "boolean", "config", "boolean_config",
]);

export const planRequiredEnum = pgEnum("plan_required", [
  "starter", "growth", "enterprise",
]);

export const features = pgTable("features", {
  id:             varchar("id", { length: 80 }).primaryKey(),
  name:           varchar("name", { length: 150 }).notNull(),
  description:    text("description"),
  category:       featureCategoryEnum("category").notNull(),
  featureType:    featureTypeEnum("feature_type").notNull().default("boolean"),
  defaultEnabled: boolean("default_enabled").notNull().default(false),
  defaultConfig:  json("default_config"),
  configSchema:   json("config_schema"),
  planRequired:   planRequiredEnum("plan_required").notNull().default("starter"),
  isBeta:         boolean("is_beta").notNull().default(false),
  sortOrder:      smallint("sort_order").notNull().default(0),
  createdAt:      timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("features_category_idx").on(t.category),
  index("features_plan_idx").on(t.planRequired),
]);
