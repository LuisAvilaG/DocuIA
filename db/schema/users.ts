import {
  pgTable, varchar, boolean, timestamp, index, uniqueIndex,
} from "drizzle-orm/pg-core";

export const platformAdmins = pgTable("platform_admins", {
  id:           varchar("id", { length: 36 }).primaryKey(),
  email:        varchar("email", { length: 191 }).notNull(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  fullName:     varchar("full_name", { length: 255 }),
  isActive:     boolean("is_active").notNull().default(true),
  lastLoginAt:  timestamp("last_login_at"),
  createdAt:    timestamp("created_at").notNull().defaultNow(),
  updatedAt:    timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("platform_admins_email_idx").on(t.email),
]);
