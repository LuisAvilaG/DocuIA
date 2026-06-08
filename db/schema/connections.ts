import {
  pgTable, varchar, text, boolean,
  timestamp, pgEnum, uniqueIndex, index,
} from "drizzle-orm/pg-core";

export const nsEnvironmentEnum = pgEnum("ns_environment", ["sandbox", "production"]);

export const nsConnectionStatusEnum = pgEnum("ns_connection_status", [
  "pending", "testing", "connected", "error",
]);

export const nsConnections = pgTable("ns_connections", {
  id:                 varchar("id", { length: 36 }).primaryKey(),
  organizationId:     varchar("organization_id", { length: 36 }).notNull(),
  environment:        nsEnvironmentEnum("environment").notNull(),

  // TBA Credentials
  accountId:          varchar("account_id", { length: 100 }).notNull(),
  consumerKey:        text("consumer_key").notNull(),
  consumerSecret:     text("consumer_secret").notNull(),
  tokenId:            text("token_id").notNull(),
  tokenSecret:        text("token_secret").notNull(),

  // Installed script IDs (set after installation)
  catalogScriptId:    varchar("catalog_script_id", { length: 50 }),
  catalogDeployId:    varchar("catalog_deploy_id", { length: 50 }),
  processScriptId:    varchar("process_script_id", { length: 50 }),
  processDeployId:    varchar("process_deploy_id", { length: 50 }),

  // Connection status
  connectionStatus:   nsConnectionStatusEnum("connection_status").notNull().default("pending"),
  connectionTestedAt: timestamp("connection_tested_at"),
  connectionError:    text("connection_error"),

  // Scripts installation
  scriptsInstalled:   boolean("scripts_installed").notNull().default(false),
  scriptsInstalledAt: timestamp("scripts_installed_at"),
  installMethod:      varchar("install_method", { length: 20 }), // "auto" | "manual"

  isActive:           boolean("is_active").notNull().default(true),
  createdAt:          timestamp("created_at").notNull().defaultNow(),
  updatedAt:          timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("ns_connections_org_env_idx").on(t.organizationId, t.environment),
  index("ns_connections_org_idx").on(t.organizationId),
]);
