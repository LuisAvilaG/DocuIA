import {
  pgTable, text, varchar, timestamp, jsonb, index,
} from "drizzle-orm/pg-core";
import { randomUUID } from "crypto";

export const tenantAuditLog = pgTable("tenant_audit_log", {
  id:             text("id").primaryKey().$defaultFn(() => randomUUID()),
  organizationId: text("organization_id").notNull(),
  userId:         text("user_id"),
  userEmail:      varchar("user_email", { length: 255 }),
  action:         varchar("action", { length: 100 }).notNull(),
  resourceType:   varchar("resource_type", { length: 50 }),
  resourceId:     text("resource_id"),
  metadata:       jsonb("metadata"),
  ipAddress:      varchar("ip_address", { length: 64 }),
  createdAt:      timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("t_audit_log_org_idx").on(t.organizationId),
  index("t_audit_log_org_created_idx").on(t.organizationId, t.createdAt),
]);
