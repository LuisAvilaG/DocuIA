import { pgTable, varchar, integer, timestamp, index } from "drizzle-orm/pg-core";

// Durable, cross-restart rate-limit counters. On a single Node instance the
// old in-memory Map worked but reset on every deploy; this survives restarts
// (and would also work if the app is ever scaled horizontally).
export const rateLimits = pgTable("rate_limits", {
  key:       varchar("key", { length: 191 }).primaryKey(),
  attempts:  integer("attempts").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (t) => [
  index("rate_limits_expires_idx").on(t.expiresAt),
]);
