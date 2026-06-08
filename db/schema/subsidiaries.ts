import {
  pgTable, varchar, boolean, integer, json,
  timestamp, bigserial, uniqueIndex, index, text,
} from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

// -- Subsidiaries -------------------------------------------------
// Each org can have N subsidiaries, each with its own NS credentials
// and document type configuration.

export const subsidiaries = pgTable("subsidiaries", {
  id:             varchar("id", { length: 36 }).primaryKey(),
  organizationId: varchar("organization_id", { length: 36 }).notNull(),
  name:           varchar("name", { length: 255 }).notNull(),
  nsSubsidiaryId: varchar("ns_subsidiary_id", { length: 50 }).notNull(),
  currency:       varchar("currency", { length: 10 }).notNull().default("USD"),
  locale:         varchar("locale", { length: 10 }).notNull().default("en-US"),
  isActive:       boolean("is_active").notNull().default(true),
  createdAt:      timestamp("created_at").notNull().defaultNow(),
  updatedAt:      timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("subsidiaries_org_idx").on(t.organizationId),
  uniqueIndex("subsidiaries_org_ns_idx").on(t.organizationId, t.nsSubsidiaryId),
]);

// Relations defined in relations.ts to avoid circular imports

// -- Document configs per subsidiary ------------------------------
// Defines which document types each subsidiary processes and with what engine.

export const subsidiaryDocumentConfigs = pgTable("subsidiary_document_configs", {
  id:               bigserial("id", { mode: "number" }).primaryKey(),
  subsidiaryId:     varchar("subsidiary_id", { length: 36 }).notNull(),
  documentType:     varchar("document_type", { length: 50 }).notNull(),
  extractionEngine: varchar("extraction_engine", { length: 50 }).notNull(),
  isEnabled:        boolean("is_enabled").notNull().default(true),
  engineConfig:     json("engine_config"),
  createdAt:        timestamp("created_at").notNull().defaultNow(),
  updatedAt:        timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("sub_doc_configs_unique_idx").on(t.subsidiaryId, t.documentType),
  index("sub_doc_configs_subsidiary_idx").on(t.subsidiaryId),
]);

// Relations defined in relations.ts to avoid circular imports

// -- Catalog tables (unified, replacing usa_items / mx_items) -----

export const catalogItems = pgTable("catalog_items", {
  id:           bigserial("id", { mode: "number" }).primaryKey(),
  subsidiaryId: varchar("subsidiary_id", { length: 36 }).notNull(),
  internalId:   varchar("internal_id", { length: 64 }).notNull(),
  itemid:       varchar("itemid", { length: 191 }),
  name:         varchar("name", { length: 500 }),
  type:         varchar("type", { length: 120 }),
  unit:         varchar("unit", { length: 120 }),
  drtUnitId:    varchar("drt_unit_id", { length: 255 }),
  drtUnitName:  varchar("drt_unit_name", { length: 255 }),
  serviceOnly:  boolean("service_only").notNull().default(false),
  updatedAt:    timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("catalog_items_sub_internal_idx").on(t.subsidiaryId, t.internalId),
  index("catalog_items_sub_name_idx").on(t.subsidiaryId, t.name),
  index("catalog_items_sub_itemid_idx").on(t.subsidiaryId, t.itemid),
]);

export const catalogVendors = pgTable("catalog_vendors", {
  id:           bigserial("id", { mode: "number" }).primaryKey(),
  subsidiaryId: varchar("subsidiary_id", { length: 36 }).notNull(),
  internalId:   varchar("internal_id", { length: 64 }).notNull(),
  entityid:     varchar("entityid", { length: 191 }),
  name:         varchar("name", { length: 500 }),
  email:        varchar("email", { length: 255 }),
  phone:        varchar("phone", { length: 100 }),
  rfc:          varchar("rfc", { length: 50 }),
  isInactive:   boolean("is_inactive").notNull().default(false),
  updatedAt:    timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("catalog_vendors_sub_internal_idx").on(t.subsidiaryId, t.internalId),
  index("catalog_vendors_sub_name_idx").on(t.subsidiaryId, t.name),
]);

export const catalogLocations = pgTable("catalog_locations", {
  id:           bigserial("id", { mode: "number" }).primaryKey(),
  subsidiaryId: varchar("subsidiary_id", { length: 36 }).notNull(),
  internalId:   varchar("internal_id", { length: 64 }).notNull(),
  name:         varchar("name", { length: 500 }),
  fullName:     varchar("full_name", { length: 500 }),
  isInactive:   boolean("is_inactive").notNull().default(false),
  updatedAt:    timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("catalog_locations_sub_internal_idx").on(t.subsidiaryId, t.internalId),
  index("catalog_locations_sub_name_idx").on(t.subsidiaryId, t.name),
]);

// -- Item mapping memory (unified) --------------------------------

export const itemMappings = pgTable("item_mappings", {
  id:                 bigserial("id", { mode: "number" }).primaryKey(),
  subsidiaryId:       varchar("subsidiary_id", { length: 36 }).notNull(),
  vendor:             varchar("vendor", { length: 191 }).notNull(),
  vendorNorm:         varchar("vendor_norm", { length: 191 }).notNull(),
  vendorItemName:     varchar("vendor_item_name", { length: 512 }).notNull(),
  vendorItemNorm:     varchar("vendor_item_norm", { length: 512 }).notNull(),
  netsuiteInternalId: varchar("netsuite_internal_id", { length: 64 }).notNull(),
  netsuiteItemName:   varchar("netsuite_item_name", { length: 255 }),
  netsuiteUnit:       varchar("netsuite_unit", { length: 64 }),
  timesConfirmed:     integer("times_confirmed").notNull().default(1),
  autoMap:            boolean("auto_map").notNull().default(false),
  lastConfirmed:      timestamp("last_confirmed"),
  createdAt:          timestamp("created_at").notNull().defaultNow(),
  updatedAt:          timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("item_mappings_unique_idx").on(t.subsidiaryId, t.vendorNorm, t.vendorItemNorm),
  index("item_mappings_vendor_idx").on(t.subsidiaryId, t.vendorNorm),
  index("item_mappings_automap_idx").on(t.subsidiaryId, t.autoMap),
]);
