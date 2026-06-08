import {
  pgTable, varchar, text, timestamp, boolean, integer,
  decimal, json, pgEnum, uniqueIndex, index, serial, bigserial,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { organizations } from "./organizations";

// -- Plans ---------------------------------------------------------

export const plans = pgTable("plans", {
  id:                   varchar("id", { length: 50 }).primaryKey(),
  name:                 varchar("name", { length: 100 }).notNull(),
  description:          text("description"),
  priceMonthly:         decimal("price_monthly", { precision: 10, scale: 2 }).notNull().default("0"),
  priceYearly:          decimal("price_yearly", { precision: 10, scale: 2 }),
  docsLimit:            integer("docs_limit").notNull().default(100),
  usersLimit:           integer("users_limit").notNull().default(1),
  subsidiariesLimit:    integer("subsidiaries_limit").notNull().default(1),
  overagePerDoc:        decimal("overage_per_doc", { precision: 8, scale: 4 }).notNull().default("0"),
  stripePriceIdMonthly: varchar("stripe_price_id_monthly", { length: 100 }),
  stripePriceIdYearly:  varchar("stripe_price_id_yearly", { length: 100 }),
  isActive:             boolean("is_active").notNull().default(true),
  sortOrder:            integer("sort_order").notNull().default(0),
  createdAt:            timestamp("created_at").notNull().defaultNow(),
});

// -- Subscriptions -------------------------------------------------

export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "trialing", "active", "past_due", "canceled", "unpaid",
]);

export const subscriptions = pgTable("subscriptions", {
  id:                    varchar("id", { length: 36 }).primaryKey(),
  organizationId:        varchar("organization_id", { length: 36 }).notNull(),
  planId:                varchar("plan_id", { length: 50 }).notNull(),
  stripeSubscriptionId:  varchar("stripe_subscription_id", { length: 100 }),
  status:                subscriptionStatusEnum("status").notNull().default("trialing"),
  currentPeriodStart:    timestamp("current_period_start").notNull(),
  currentPeriodEnd:      timestamp("current_period_end").notNull(),
  cancelAtPeriodEnd:     boolean("cancel_at_period_end").notNull().default(false),
  canceledAt:            timestamp("canceled_at"),
  trialEnd:              timestamp("trial_end"),
  createdAt:             timestamp("created_at").notNull().defaultNow(),
  updatedAt:             timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("subscriptions_org_idx").on(t.organizationId),
  index("subscriptions_stripe_idx").on(t.stripeSubscriptionId),
]);

// -- Usage events --------------------------------------------------

export const usageEventTypeEnum = pgEnum("usage_event_type", [
  "doc_processed", "ai_primary_call", "ai_fallback_call",
  "sync_run", "api_call", "bulk_upload_doc", "webhook_delivery",
]);

export const usageEvents = pgTable("usage_events", {
  id:             bigserial("id", { mode: "number" }).primaryKey(),
  organizationId: varchar("organization_id", { length: 36 }).notNull(),
  subsidiaryId:   varchar("subsidiary_id", { length: 36 }),
  eventType:      usageEventTypeEnum("event_type").notNull(),
  documentType:   varchar("document_type", { length: 60 }),
  aiModel:        varchar("ai_model", { length: 120 }),
  tokensInput:    integer("tokens_input"),
  tokensOutput:   integer("tokens_output"),
  durationMs:     integer("duration_ms"),
  metadataJson:   json("metadata_json"),
  createdAt:      timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("usage_events_org_date_idx").on(t.organizationId, t.createdAt),
  index("usage_events_type_date_idx").on(t.eventType, t.createdAt),
]);

// -- Daily aggregates ---------------------------------------------

export const usageDaily = pgTable("usage_daily", {
  id:               bigserial("id", { mode: "number" }).primaryKey(),
  organizationId:   varchar("organization_id", { length: 36 }).notNull(),
  date:             varchar("date", { length: 10 }).notNull(),
  docsProcessed:    integer("docs_processed").notNull().default(0),
  docsInvoice:      integer("docs_invoice").notNull().default(0),
  docsPo:           integer("docs_po").notNull().default(0),
  docsXml:          integer("docs_xml").notNull().default(0),
  aiPrimaryCalls:   integer("ai_primary_calls").notNull().default(0),
  aiFallbackCalls:  integer("ai_fallback_calls").notNull().default(0),
  aiTokensInput:    integer("ai_tokens_input").notNull().default(0),
  aiTokensOutput:   integer("ai_tokens_output").notNull().default(0),
  syncRuns:         integer("sync_runs").notNull().default(0),
  apiCalls:         integer("api_calls").notNull().default(0),
  errors:           integer("errors").notNull().default(0),
  totalAmount:      decimal("total_amount", { precision: 18, scale: 2 }).notNull().default("0"),
  createdAt:        timestamp("created_at").notNull().defaultNow(),
  updatedAt:        timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("usage_daily_org_date_idx").on(t.organizationId, t.date),
  index("usage_daily_date_idx").on(t.date),
]);

// -- Feature flags per org ----------------------------------------

export const orgFeatures = pgTable("org_features", {
  id:             bigserial("id", { mode: "number" }).primaryKey(),
  organizationId: varchar("organization_id", { length: 36 }).notNull(),
  featureId:      varchar("feature_id", { length: 80 }).notNull(),
  adminGranted:   boolean("admin_granted").notNull().default(false),
  isEnabled:      boolean("is_enabled").notNull().default(false),
  configJson:     json("config_json"),
  enabledBy:      varchar("enabled_by", { length: 36 }),
  notes:          text("notes"),
  createdAt:      timestamp("created_at").notNull().defaultNow(),
  updatedAt:      timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("org_features_org_feature_idx").on(t.organizationId, t.featureId),
  index("org_features_feature_idx").on(t.featureId),
]);

// Relations defined in relations.ts to avoid circular imports
