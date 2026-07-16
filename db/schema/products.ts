import {
  pgTable, varchar, text, boolean, integer, json,
  bigserial, timestamp, pgEnum, uniqueIndex, index,
} from "drizzle-orm/pg-core";

// A product is a first-class capability bundle a client can subscribe to
// à la carte (AP automation, expense management, contract intelligence).
export const products = pgTable("products", {
  key:                 varchar("key", { length: 40 }).primaryKey(),
  name:                varchar("name", { length: 120 }).notNull(),
  description:         text("description"),
  icon:                varchar("icon", { length: 60 }),
  // Whether this product needs an external integration (e.g. NetSuite) during onboarding.
  requiresIntegration: boolean("requires_integration").notNull().default(false),
  sortOrder:           integer("sort_order").notNull().default(0),
  createdAt:           timestamp("created_at").notNull().defaultNow(),
});

export const orgProductStatusEnum = pgEnum("org_product_status", ["active", "trial", "disabled"]);

// Which products an organization has. This is the source of truth for access:
// a feature belonging to a product is only usable if that product is active here.
export const orgProducts = pgTable("org_products", {
  id:             bigserial("id", { mode: "number" }).primaryKey(),
  organizationId: varchar("organization_id", { length: 36 }).notNull(),
  productKey:     varchar("product_key", { length: 40 }).notNull(),
  status:         orgProductStatusEnum("status").notNull().default("active"),
  configJson:     json("config_json"),
  enabledAt:      timestamp("enabled_at").notNull().defaultNow(),
  updatedAt:      timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("org_products_org_product_idx").on(t.organizationId, t.productKey),
  index("org_products_org_idx").on(t.organizationId),
]);
