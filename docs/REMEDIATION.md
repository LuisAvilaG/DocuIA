# DocuIA — Remediación de auditoría (Fases 0–5)

Registro de los cambios aplicados tras la auditoría integral (seguridad, rendimiento,
correctitud NetSuite, DevOps). Cada fase se cerró con QA (tsc limpio + pruebas de lógica
y/o contra la base de datos viva).

## Fase 0 — Críticas
- **JWT sin fallback** (`lib/env.ts`, `proxy.ts`, `lib/auth/jwt.ts`): eliminado el secreto
  hardcodeado; `jwtSecret()` exige `JWT_SECRET` ≥32 chars o lanza error.
- **Montos de gastos validados en servidor** (`lib/expense/tax-engine.ts` →
  `validateExpenseAmounts`, usado en `expenses/items` POST/PATCH): invariante aritmética
  + cotas; cierra el exploit `subtotal:100 → total:5.000.000`.
- **Vendor Bill de gastos** (`scripts/netsuite/docuia-process-v1.js`,
  `lib/expense/sync-to-netsuite.ts`): sublista `expense` por cuenta contable de la categoría
  (antes enviaba una línea con item vacío que NS descartaba).

## Fase 1 — Integridad de datos NetSuite
- `externalId` determinista en toda creación NS (dedup atómico anti-duplicados).
- Moneda ISO→internalId resuelta en el RESTlet (search de currency).
- Auto-proceso endurecido: la confianza incorpora la **calidad del match** (score de
  ítem/vendor), no solo completitud de campos; memoria fuzzy 0.7 ya no finge certeza.
- Fecha `YYYY-MM-DD` en el prompt de Gemini (elimina ambigüedad MM/DD vs DD/MM).
- CFDI: word-boundary en la regex (adiós línea fantasma `<Conceptos>`) + impuestos reales
  desde `cfdi:Impuestos`/`Descuento`.
- `approve` filtra por `docId` en el handler de error (no resetea otros docs).
- Sync de gastos: subsidiaria determinista, `createVendor` con subsidiaria, estado
  `exception` re-sincronizable, body REST del Expense Report corregido.
- Tax engine: reglas seed marcadas como plantillas revisables, UVT parametrizado, redondeo
  a centavos; retry con backoff en Gemini (429/5xx).

## Fase 2 — Infraestructura
- **Cola pg-boss** (`lib/queue/`, `instrumentation.ts`): el pipeline corre en un worker
  in-process; el upload responde `202 {status:"queued"}` cuando `document_storage` está
  activo, con fallback inline. `createQueuedDocument` persiste archivo + fila antes de encolar.
- **Timeouts** con `AbortSignal` en Gemini (90s) y NetSuite (30s).
- **Watchdog** `GET /api/internal/cron/reap-stuck`: marca `failed` documentos huérfanos.
- **Rate-limit durable** en Postgres (tabla `rate_limits`, upsert atómico).

## Fase 3 — Rendimiento
- `columns:` selectivo en /history, /workflow, dashboard (nunca traen el JSON `products`).
- Export CSV como **stream por cursor** (no carga toda la tabla en memoria).
- Polling: estados terminales completos, endpoint **batch** `?ids=`, backoff exponencial.
- Cron auto-sync con **upserts por lote** (1 statement/página vs 1/fila).
- MinIO: archivos servidos por **stream**; `ensureBucket` cacheado.
- react-pdf con `next/dynamic`; worker de pdf.js **self-hosted** (sin CDN unpkg).
- Matching: truncación determinista + cap configurable con aviso (pg_trgm = follow-up).

## Fase 4 — Hardening
- Cabeceras de seguridad (`next.config.ts`): X-Frame-Options, nosniff, Referrer-Policy,
  Permissions-Policy, HSTS, CSP base.
- SSL a Postgres en producción (`DATABASE_SSL`).
- Rate-limit en forgot/reset/change-password.
- **Anti-SSRF** en webhooks (`lib/webhooks/ssrf.ts`): bloquea IPs internas en creación y
  entrega (anti-rebinding).
- CSV formula-injection neutralizado; HTML escapado en emails.
- Auditoría incondicional (independiente de la feature de billing).
- Sin credenciales por defecto (MinIO fail-fast, docker-compose parametrizado, admin con
  contraseña aleatoria en setup).
- bcrypt coste 12; token de reset hasheado (SHA-256); change-password revoca sesiones;
  `REFRESH_SECRET` separado + `algorithms:["HS256"]`.
- **M-4**: email globalmente único (`org_users_email_unique_idx`) — login multi-org
  inequívoco.

## Fase 5 — DevOps
- **Migraciones versionadas**: `db/migrations/0000_baseline.sql` + DB existente baselineada
  (ver flujo abajo).
- **CI**: `.github/workflows/ci.yml` (tsc gate + eslint advisory).
- **Dockerfile** multi-stage con `output: "standalone"`; healthchecks en docker-compose.
- `sso_saml` removido del seed (feature vacía).

---

## Flujo de migraciones (a partir de ahora)
1. Cambias el schema en `db/schema/`.
2. `npx drizzle-kit generate --name=<cambio>` → nueva migración en `db/migrations/`.
3. `npx drizzle-kit migrate` la aplica (idempotente vía `drizzle.__drizzle_migrations`).

La base actual ya está **baselineada** en `0000_baseline` (no re-crea tablas). Para adoptar
migraciones en OTRA base existente ya poblada, insertar el baseline como aplicado antes de
`migrate` (hash sha256 del `.sql`).

## Acciones de despliegue pendientes
- `npm install` (nueva dependencia `pg-boss`).
- Redeploy del SuiteScript `docuia-process-v1.js` en NetSuite.
- Configurar el scheduler para `GET /api/internal/cron/reap-stuck` (header `X-Cron-Secret`).
- Definir `DATABASE_SSL`, timeouts y demás en el `.env` de producción (ver `.env.example`).

## Deuda técnica conocida (follow-ups)
- Matching a `pg_trgm` (scoring en SQL) para catálogos > cap.
- e2e en CI contra docker-compose (servicios + seeds + `next start`).
- Tablas de schema sin uso: `impersonation_sessions`, `notification_preferences`,
  `usage_events` — terminar o eliminar.
- `any` preexistentes en el código (endurecer el gate de lint tras limpiarlos).
- Billing/Stripe (no implementado) y enforcement de `docsLimit`.
