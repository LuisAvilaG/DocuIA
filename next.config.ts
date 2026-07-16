import type { NextConfig } from "next";

// Baseline security headers applied to every response.
// NOTE: a full script-src CSP (nonce/strict-dynamic) is a follow-up — it needs
// per-request nonce wiring with the App Router. This baseline still blocks the
// high-impact vectors: clickjacking (frame-ancestors), object/base injection,
// MIME sniffing, referrer leakage, and TLS downgrade (HSTS, honored over HTTPS).
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Expense capture uses the rear camera; mic/geolocation are never needed.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'" },
];

const nextConfig: NextConfig = {
  turbopack: {},
  // Self-contained server bundle for a small production Docker image.
  // (Next 16 no longer runs ESLint during build; CI lints separately.)
  output: "standalone",
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
