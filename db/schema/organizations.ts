import {
  pgTable, varchar, text, timestamp, boolean,
  pgEnum, uniqueIndex, index, real,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const orgStatusEnum = pgEnum("org_status", [
  "trial", "active", "suspended", "churned",
]);

export const organizations = pgTable("organizations", {
  id:               varchar("id", { length: 36 }).primaryKey(),
  name:             varchar("name", { length: 255 }).notNull(),
  slug:             varchar("slug", { length: 100 }).notNull(),
  status:           orgStatusEnum("status").notNull().default("trial"),
  trialEndsAt:      timestamp("trial_ends_at"),
  stripeCustomerId: varchar("stripe_customer_id", { length: 100 }),
  billingEmail:     varchar("billing_email", { length: 255 }),
  timezone:         varchar("timezone", { length: 60 }).notNull().default("America/Mexico_City"),
  logoUrl:              text("logo_url"),
  primaryColor:         varchar("primary_color", { length: 7 }),
  activeNsEnvironment:      varchar("active_ns_environment", { length: 20 }).default("sandbox"),
  autoProcessThreshold:     real("auto_process_threshold").notNull().default(0.85),
  aiApiKeyEncrypted:        text("ai_api_key_encrypted"),
  createdAt:                timestamp("created_at").notNull().defaultNow(),
  updatedAt:                timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("organizations_slug_idx").on(t.slug),
]);

// -- Users ---------------------------------------------------------

export const userRoleEnum = pgEnum("user_role", ["admin", "operator", "viewer", "expense_submitter"]);

export const orgUsers = pgTable("org_users", {
  id:             varchar("id", { length: 36 }).primaryKey(),
  organizationId: varchar("organization_id", { length: 36 }).notNull(),
  email:          varchar("email", { length: 191 }).notNull(),
  passwordHash:   varchar("password_hash", { length: 255 }),
  fullName:       varchar("full_name", { length: 255 }),
  role:           userRoleEnum("role").notNull().default("operator"),
  isActive:       boolean("is_active").notNull().default(true),
  lastLoginAt:    timestamp("last_login_at"),
  invitedBy:      varchar("invited_by", { length: 36 }),
  emailVerified:  boolean("email_verified").notNull().default(false),
  verifyToken:    varchar("verify_token", { length: 100 }),
  resetToken:          varchar("reset_token", { length: 100 }),
  resetTokenExpiresAt: timestamp("reset_token_expires_at"),
  netsuiteEmployeeId:  varchar("netsuite_employee_id", { length: 64 }),
  managerId:           varchar("manager_id", { length: 36 }),
  createdAt:      timestamp("created_at").notNull().defaultNow(),
  updatedAt:      timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  // Email is globally unique across the platform (M-4): a single address maps to
  // exactly one user, so login-by-email is unambiguous across organizations.
  uniqueIndex("org_users_email_unique_idx").on(t.email),
]);

// -- Auth sessions -------------------------------------------------

export const userTypeEnum = pgEnum("user_type", ["org_user", "platform_admin"]);

export const authSessions = pgTable("auth_sessions", {
  id:             varchar("id", { length: 36 }).primaryKey(),
  userId:         varchar("user_id", { length: 36 }).notNull(),
  userType:       userTypeEnum("user_type").notNull(),
  organizationId: varchar("organization_id", { length: 36 }),
  refreshToken:   varchar("refresh_token", { length: 255 }).notNull(),
  ipAddress:      varchar("ip_address", { length: 64 }),
  userAgent:      text("user_agent"),
  expiresAt:      timestamp("expires_at").notNull(),
  revokedAt:      timestamp("revoked_at"),
  createdAt:      timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("auth_sessions_token_idx").on(t.refreshToken),
  index("auth_sessions_user_idx").on(t.userId, t.userType),
]);
