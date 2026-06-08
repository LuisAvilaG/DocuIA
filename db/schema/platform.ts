import {
  pgTable, varchar, text, boolean, integer, smallint,
  json, timestamp, bigserial, uniqueIndex, index,
} from "drizzle-orm/pg-core";

// -- Onboarding progress ------------------------------------------

export const onboardingProgress = pgTable("onboarding_progress", {
  id:                       bigserial("id", { mode: "number" }).primaryKey(),
  organizationId:           varchar("organization_id", { length: 36 }).notNull(),
  stepAccountCreated:       boolean("step_account_created").notNull().default(true),
  stepEmailVerified:        boolean("step_email_verified").notNull().default(false),
  stepNsConfigured:         boolean("step_ns_configured").notNull().default(false),
  stepFirstSync:            boolean("step_first_sync").notNull().default(false),
  stepFirstDoc:             boolean("step_first_doc").notNull().default(false),
  stepTeamInvited:          boolean("step_team_invited").notNull().default(false),
  stepMappings10:           boolean("step_mappings_10").notNull().default(false),
  stepWebhookConfigured:    boolean("step_webhook_configured").notNull().default(false),
  healthScore:              smallint("health_score").notNull().default(0),
  totalSteps:               smallint("total_steps").notNull().default(8),
  completedSteps:           smallint("completed_steps").notNull().default(0),
  completedAt:              timestamp("completed_at"),
  lastEvaluatedAt:          timestamp("last_evaluated_at"),
  createdAt:                timestamp("created_at").notNull().defaultNow(),
  updatedAt:                timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("onboarding_org_idx").on(t.organizationId),
  index("onboarding_health_idx").on(t.healthScore),
]);

// -- API Keys -----------------------------------------------------

export const apiKeys = pgTable("api_keys", {
  id:             varchar("id", { length: 36 }).primaryKey(),
  organizationId: varchar("organization_id", { length: 36 }).notNull(),
  name:           varchar("name", { length: 100 }).notNull(),
  keyHash:        varchar("key_hash", { length: 255 }).notNull(),
  keyPrefix:      varchar("key_prefix", { length: 16 }).notNull(),
  scopes:         json("scopes").notNull(),
  lastUsedAt:     timestamp("last_used_at"),
  lastUsedIp:     varchar("last_used_ip", { length: 64 }),
  expiresAt:      timestamp("expires_at"),
  createdBy:      varchar("created_by", { length: 36 }).notNull(),
  revokedAt:      timestamp("revoked_at"),
  revokedBy:      varchar("revoked_by", { length: 36 }),
  createdAt:      timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("api_keys_prefix_idx").on(t.keyPrefix),
  index("api_keys_org_idx").on(t.organizationId),
  index("api_keys_hash_idx").on(t.keyHash),
]);

// -- Admin audit log (append-only) --------------------------------

export const adminAuditLog = pgTable("admin_audit_log", {
  id:             bigserial("id", { mode: "number" }).primaryKey(),
  adminId:        varchar("admin_id", { length: 36 }).notNull(),
  adminEmail:     varchar("admin_email", { length: 191 }).notNull(),
  action:         varchar("action", { length: 100 }).notNull(),
  targetOrgId:    varchar("target_org_id", { length: 36 }),
  targetOrgName:  varchar("target_org_name", { length: 255 }),
  targetUserId:   varchar("target_user_id", { length: 36 }),
  targetFeature:  varchar("target_feature", { length: 80 }),
  beforeJson:     json("before_json"),
  afterJson:      json("after_json"),
  ipAddress:      varchar("ip_address", { length: 64 }),
  userAgent:      text("user_agent"),
  createdAt:      timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("audit_log_admin_idx").on(t.adminId, t.createdAt),
  index("audit_log_org_idx").on(t.targetOrgId, t.createdAt),
  index("audit_log_action_idx").on(t.action, t.createdAt),
]);

// -- Impersonation sessions ---------------------------------------

export const impersonationSessions = pgTable("impersonation_sessions", {
  id:             varchar("id", { length: 36 }).primaryKey(),
  adminId:        varchar("admin_id", { length: 36 }).notNull(),
  organizationId: varchar("organization_id", { length: 36 }).notNull(),
  targetUserId:   varchar("target_user_id", { length: 36 }).notNull(),
  reason:         text("reason").notNull(),
  expiresAt:      timestamp("expires_at").notNull(),
  endedAt:        timestamp("ended_at"),
  createdAt:      timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("impersonation_admin_idx").on(t.adminId),
  index("impersonation_org_idx").on(t.organizationId),
]);

// -- Notification preferences ------------------------------------

export const notificationPreferences = pgTable("notification_preferences", {
  id:                    bigserial("id", { mode: "number" }).primaryKey(),
  userId:                varchar("user_id", { length: 36 }).notNull(),
  organizationId:        varchar("organization_id", { length: 36 }).notNull(),
  notifyDocProcessed:    boolean("notify_doc_processed").notNull().default(true),
  notifyDocFailed:       boolean("notify_doc_failed").notNull().default(true),
  notifyDocNeedsReview:  boolean("notify_doc_needs_review").notNull().default(true),
  notifyDuplicateFound:  boolean("notify_duplicate_found").notNull().default(true),
  notifySyncFailed:      boolean("notify_sync_failed").notNull().default(true),
  notifySyncCompleted:   boolean("notify_sync_completed").notNull().default(false),
  notifyQuota80pct:      boolean("notify_quota_80pct").notNull().default(true),
  notifyQuota100pct:     boolean("notify_quota_100pct").notNull().default(true),
  notifyBillingInvoice:  boolean("notify_billing_invoice").notNull().default(true),
  notifyWeeklyReport:    boolean("notify_weekly_report").notNull().default(false),
  notifyMonthlyReport:   boolean("notify_monthly_report").notNull().default(false),
  createdAt:             timestamp("created_at").notNull().defaultNow(),
  updatedAt:             timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("notif_prefs_user_idx").on(t.userId),
  index("notif_prefs_org_idx").on(t.organizationId),
]);
