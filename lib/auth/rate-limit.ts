import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

/**
 * Durable, atomic rate limiter backed by Postgres (table `rate_limits`).
 *
 * A single upsert both increments the counter and rolls the window when it has
 * expired, so concurrent requests can't race past the limit. Allows up to `max`
 * attempts per `windowSec`; the (max+1)-th within the window is rejected.
 */
export async function rateLimit(
  key: string,
  { max = 5, windowSec = 900 }: { max?: number; windowSec?: number } = {}
): Promise<{ ok: boolean; retryAfterSec?: number }> {
  try {
    const res = await db.execute(sql`
      INSERT INTO rate_limits (key, attempts, expires_at)
      VALUES (${key}, 1, now() + (${windowSec} * interval '1 second'))
      ON CONFLICT (key) DO UPDATE SET
        attempts = CASE WHEN rate_limits.expires_at < now() THEN 1 ELSE rate_limits.attempts + 1 END,
        expires_at = CASE WHEN rate_limits.expires_at < now()
                          THEN now() + (${windowSec} * interval '1 second')
                          ELSE rate_limits.expires_at END
      RETURNING attempts, ceil(extract(epoch from (expires_at - now())))::int AS retry_after
    `);
    const rows = (res as unknown as { rows: Array<{ attempts: number; retry_after: number }> }).rows;
    const row = rows?.[0];
    if (row && Number(row.attempts) > max) {
      return { ok: false, retryAfterSec: Math.max(1, Number(row.retry_after)) };
    }
    return { ok: true };
  } catch {
    // Fail open: never lock users out because the limiter's storage hiccuped.
    return { ok: true };
  }
}

export async function clearRateLimit(key: string): Promise<void> {
  try {
    await db.execute(sql`DELETE FROM rate_limits WHERE key = ${key}`);
  } catch {
    /* best-effort */
  }
}
