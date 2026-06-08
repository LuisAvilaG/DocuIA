type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

// Purge expired buckets every minute (works in persistent Node.js process)
setInterval(() => {
  const now = Date.now();
  for (const [key, b] of buckets) {
    if (b.resetAt < now) buckets.delete(key);
  }
}, 60_000).unref?.();

export function rateLimit(
  ip: string,
  { max = 5, windowSec = 900 }: { max?: number; windowSec?: number } = {}
): { ok: boolean; retryAfterSec?: number } {
  const now = Date.now();
  const windowMs = windowSec * 1000;
  const b = buckets.get(ip);

  if (!b || b.resetAt < now) {
    buckets.set(ip, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }
  if (b.count >= max) {
    return { ok: false, retryAfterSec: Math.ceil((b.resetAt - now) / 1000) };
  }
  b.count++;
  return { ok: true };
}

export function clearRateLimit(ip: string) {
  buckets.delete(ip);
}
