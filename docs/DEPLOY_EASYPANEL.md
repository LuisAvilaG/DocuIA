# Despliegue en EasyPanel

DocuIA se despliega como **una app + 2 servicios de datos**. No usa Redis.
El worker del pipeline (pg-boss) corre **dentro** del contenedor de la app
(`instrumentation.ts`), y las **migraciones se aplican solas al arrancar**
(`scripts/migrate.mjs`, ejecutado por el `Dockerfile` antes de `server.js`).

## Servicios a crear

### 1. Postgres
- Template Postgres de EasyPanel (16+), con volumen persistente.
- Es la base de datos **y** la cola de trabajos (pg-boss).
- Anota host, usuario, contraseña y base (p. ej. `docuia`).

### 2. MinIO (almacenamiento de documentos)
- Servicio Docker, imagen `minio/minio:latest`.
- Comando: `server /data --console-address ":9001"`.
- Volumen persistente en `/data`. Puertos 9000 (API) y 9001 (consola).
- Variables: `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`.
- El bucket se crea solo al primer uso (no hay que crearlo a mano).

### 3. App — DocuIA
- Tipo **App**, source = este repositorio (rama `master`), build por **Dockerfile**.
- Puerto interno **3000**; asigna tu dominio con HTTPS.
- Conéctala a la red interna de Postgres y MinIO.

## Variables de entorno de la App
```
NODE_ENV=production
NEXT_PUBLIC_APP_URL=https://tu-dominio

# Base de datos. Para el Postgres INTERNO de EasyPanel (red privada, sin TLS):
DATABASE_URL=postgresql://usuario:pass@<host-postgres>:5432/docuia
DATABASE_SSL=false
# Para una base EXTERNA/gestionada con TLS: DATABASE_SSL=true  (y ?sslmode=require en la URL)
# Si el certificado es self-signed:            DATABASE_SSL_NO_VERIFY=true

# Secretos (genera cada uno único, >=32 chars):
#   node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
JWT_SECRET=...
REFRESH_SECRET=...
ENCRYPTION_KEY=...            # 64 hex; si ya hay credenciales NS cifradas, CONSÉRVALA
CRON_SECRET=...

# Almacenamiento
MINIO_ENDPOINT=<host-minio>
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=<MINIO_ROOT_USER>
MINIO_SECRET_KEY=<MINIO_ROOT_PASSWORD>
MINIO_BUCKET=docuia

# IA + correo
GEMINI_API_KEY=...
RESEND_API_KEY=...            # opcional si no se envían correos aún

# Opcionales (defaults razonables)
GEMINI_TIMEOUT_MS=90000
STUCK_DOC_MINUTES=15

# Solo primer arranque: crea el super-admin de la plataforma
PLATFORM_ADMIN_EMAIL=admin@tu-dominio
PLATFORM_ADMIN_PASSWORD=<contraseña-fuerte>
```

## Migraciones
Automáticas: el contenedor ejecuta `node scripts/migrate.mjs && node server.js`.
Aplica solo las migraciones pendientes (tracking `drizzle.__drizzle_migrations`),
idempotente. Si la base no está lista al arrancar, el contenedor falla y EasyPanel
reintenta hasta que Postgres responda.

## Scheduler interno
No se configura ningún cron externo. Al iniciar la app, su worker pg-boss
registra en PostgreSQL tareas persistentes y respeta en cada ejecución los
features y configuración actuales de cada tenant. Funciona también con más de
una réplica: PostgreSQL asegura que cada trabajo se procese una sola vez.

| Frecuencia (America/Mexico_City) | Tarea |
|---|---|
| cada 5 min | recuperar documentos atascados y auto-sync de catálogos |
| diario 02:20 | sincronizar catálogos de gastos |
| diario 03:00 | aplicar retención de datos |
| diario 08:00 | enviar reportes programados |
| diario 08:15 | alertas de contratos |

`CRON_SECRET` continúa siendo obligatorio: protege los endpoints internos de
diagnóstico (`GET /api/internal/cron/*`), aunque el scheduler normal ya no los
invoca desde internet. Para detener el scheduler temporalmente durante una
intervención, configura `INTERNAL_SCHEDULER_ENABLED=false` y reinicia la app.

## Orden de despliegue
1. Crear Postgres y MinIO (esperar healthy).
2. Crear la App con sus variables; primer deploy → migra + arranca + crea super-admin.
3. Entrar como super-admin (`/admin/login`), crear el primer cliente con el producto Contract Intelligence.
4. Confirmar en los logs de la app el mensaje `[scheduler] internal schedules registered`.
