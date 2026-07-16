# syntax=docker/dockerfile:1

# ── deps ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ── builder ───────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Next produces a self-contained server under .next/standalone (output: "standalone").
RUN npm run build

# ── runner ────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Run as non-root.
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# public/ (includes the self-hosted pdf.js worker) + the standalone server + static assets.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# The SuiteScript download route reads these from disk at runtime (fs.readFile);
# Next's standalone tracing doesn't include them, so copy them explicitly.
COPY --from=builder /app/scripts/netsuite ./scripts/netsuite
# Versioned migrations + the runtime migrator (runs on boot before the server).
COPY --from=builder /app/db/migrations ./db/migrations
COPY --from=builder /app/scripts/migrate.mjs ./scripts/migrate.mjs
# Full drizzle-orm so the migrator submodule is present in the standalone image
# (Next's tracing only bundles the parts the server imports).
COPY --from=builder /app/node_modules/drizzle-orm ./node_modules/drizzle-orm

USER nextjs
EXPOSE 3000

# Apply pending migrations, then start. instrumentation.ts boots the pg-boss
# pipeline worker inside this same process (no separate worker service needed).
CMD ["sh", "-c", "node scripts/migrate.mjs && node server.js"]
