/**
 * Centralized, validated access to security-critical environment variables.
 *
 * Secrets are resolved lazily and memoized: the first time a secret is used
 * (at request time, NOT at import/build time) it is validated and cached.
 * This fails fast on a misconfigured deployment without breaking `next build`
 * on machines where runtime env vars are injected after the build step.
 *
 * NOTE: keep this module dependency-free. It is imported by `proxy.ts`
 * (the middleware, which runs in the Edge runtime and cannot use
 * `next/headers`, `pg`, etc.).
 */

let cachedJwtSecret: Uint8Array | null = null;

/**
 * Returns the HMAC key bytes used to sign/verify JWTs.
 * Throws if JWT_SECRET is unset or shorter than 32 characters — there is
 * intentionally NO insecure fallback.
 */
export function jwtSecret(): Uint8Array {
  if (cachedJwtSecret) return cachedJwtSecret;
  const value = process.env.JWT_SECRET;
  if (!value || value.length < 32) {
    throw new Error(
      "JWT_SECRET must be set to a random string of at least 32 characters. " +
        "Generate one with: openssl rand -hex 32",
    );
  }
  cachedJwtSecret = new TextEncoder().encode(value);
  return cachedJwtSecret;
}

let cachedRefreshSecret: Uint8Array | null = null;

/**
 * Key for refresh tokens. Uses REFRESH_SECRET when configured (≥32 chars) so
 * refresh tokens are signed with a DIFFERENT key than access tokens; falls back
 * to the access-token secret otherwise, keeping existing deployments working.
 */
export function refreshSecret(): Uint8Array {
  if (cachedRefreshSecret) return cachedRefreshSecret;
  const value = process.env.REFRESH_SECRET;
  cachedRefreshSecret = value && value.length >= 32
    ? new TextEncoder().encode(value)
    : jwtSecret();
  return cachedRefreshSecret;
}
