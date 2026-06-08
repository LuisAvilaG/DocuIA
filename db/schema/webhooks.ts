import {
  pgTable, text, boolean, timestamp, integer, index,
} from "drizzle-orm/pg-core";
import { randomUUID } from "crypto";

export const webhooks = pgTable("webhooks", {
  id:              text("id").primaryKey().$defaultFn(() => randomUUID()),
  organizationId:  text("organization_id").notNull(),
  url:             text("url").notNull(),
  secret:          text("secret").notNull(),
  events:          text("events").array().notNull().default(["completed", "review", "failed"]),
  isActive:        boolean("is_active").notNull().default(true),
  lastTriggeredAt: timestamp("last_triggered_at"),
  lastStatusCode:  integer("last_status_code"),
  createdAt:       timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("webhooks_organization_id_idx").on(t.organizationId),
]);
