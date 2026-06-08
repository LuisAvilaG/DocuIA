# DocuIA — Matriz de Pruebas QA

**Versión:** 1.0  
**Fecha:** 2026-05-06  
**Proyecto:** DocuIA — SaaS multitenant de procesamiento de documentos fiscales con integración NetSuite  
**Ambiente objetivo:** Local (Docker) / Staging  
**Alcance:** FASE 1 COMPLETA. Los casos marcados con `[FASE 2]` no deben ejecutarse; la funcionalidad no está implementada.

---

## Credenciales de prueba

| Rol | Email | Contraseña | URL de acceso |
|---|---|---|---|
| Superadmin | admin@docuia.com | DocuIA2024! | /admin/login |
| Tenant admin (Enterprise) | carlos@acme.mx | Demo1234! | /login |

**Tenant demo:** Distribuidora Acme, plan Enterprise, rol admin.

---

## Requisitos de infraestructura

- Docker Desktop activo con contenedores `docuia-postgres` (puerto 5432) y `docuia-minio` (puertos 9000/9001)
- Variables de entorno en `.env.local` con `JWT_SECRET`, `ENCRYPTION_KEY`, `CRON_SECRET`, y opcionalmente `GEMINI_API_KEY`
- Scripts de seed ejecutados: `create-admin.ts`, `seed-features.ts`, `seed-demo.ts`
- Aplicación corriendo en `http://localhost:3000`

---

## Resumen de casos de prueba

| Módulo | Total | Positivos | Negativos | Borde |
|---|---|---|---|---|
| Infraestructura / Docker | 4 | 3 | 1 | 0 |
| Autenticación — Tenant | 14 | 4 | 7 | 3 |
| Autenticación — Admin | 7 | 2 | 4 | 1 |
| Recuperación de contraseña | 5 | 2 | 2 | 1 |
| Panel de Admin — Dashboard y Clientes | 8 | 5 | 3 | 0 |
| Panel de Admin — Feature Flags | 6 | 3 | 3 | 0 |
| Panel de Admin — Wizard NetSuite | 7 | 4 | 3 | 0 |
| Portal Tenant — Dashboard | 4 | 3 | 1 | 0 |
| Portal Tenant — Workflow / Upload | 18 | 5 | 10 | 3 |
| Portal Tenant — Historial | 7 | 4 | 3 | 0 |
| Portal Tenant — Excepciones | 7 | 4 | 3 | 0 |
| Portal Tenant — Mapeos y Catálogos | 4 | 2 | 2 | 0 |
| Portal Tenant — Estadísticas | 3 | 2 | 1 | 0 |
| Portal Tenant — Configuración | 14 | 7 | 5 | 2 |
| Feature Flags — Gates de UI | 12 | 6 | 6 | 0 |
| NetSuite — Conexión OAuth | 7 | 3 | 4 | 0 |
| NetSuite — Fallas específicas | 16 | 0 | 16 | 0 |
| NetSuite — Dry Run | 4 | 3 | 1 | 0 |
| Cron Jobs | 9 | 5 | 4 | 0 |
| Webhooks | 8 | 4 | 4 | 0 |
| API Keys | 8 | 4 | 4 | 0 |
| **TOTAL** | **172** | **79** | **91** | **10** |

---

## Convenciones

- **P** = Positivo (happy path)
- **N** = Negativo (entrada inválida o estado de error esperado)
- **B** = Borde (condición límite o caso edge)
- `[FASE 2]` = No implementado. No ejecutar. Se documenta para referencia futura.
- Los códigos de error NetSuite mencionados corresponden a respuestas del RESTlet, no del middleware de Next.js.

---

---

# MÓDULO 1 — Infraestructura y Docker

---

### [TC-001] Levantar servicios Docker

**Tipo:** P  
**Prioridad:** Alta

**Precondiciones:**
- Docker Desktop instalado y corriendo
- Puerto 5432 y 9000/9001 disponibles

**Pasos:**
1. Ejecutar `docker compose up -d` en el directorio raíz del proyecto
2. Esperar ~15 segundos
3. Verificar estado con `docker compose ps`

**Resultado esperado:**
- Ambos contenedores (`docuia-postgres`, `docuia-minio`) muestran estado `running`
- No hay errores de puerto en conflicto

---

### [TC-002] Conectividad a PostgreSQL

**Tipo:** P  
**Prioridad:** Alta

**Precondiciones:** TC-001 completado

**Pasos:**
1. Ejecutar `npx drizzle-kit push` o intentar conectar con un cliente psql a `localhost:5432` con usuario `docuia_user`, contraseña `docuia_local_pass`, base de datos `docuia`

**Resultado esperado:**
- Conexión exitosa
- Schema de tablas visible

---

### [TC-003] Ejecutar seeds correctamente

**Tipo:** P  
**Prioridad:** Alta

**Precondiciones:** TC-002 completado

**Pasos:**
1. Ejecutar `npx tsx scripts/create-admin.ts`
2. Ejecutar `npx tsx scripts/seed-features.ts`
3. Ejecutar `npx tsx scripts/seed-demo.ts`

**Resultado esperado:**
- Sin errores de ejecución
- Admin `admin@docuia.com` existe en tabla `platform_admins`
- 25 features en tabla `features`
- Organización "Distribuidora Acme" con usuario `carlos@acme.mx` en tabla `organizations` y `org_users`

---

### [TC-004] MinIO no disponible — document_storage activado

**Tipo:** N  
**Prioridad:** Media

**Precondiciones:**
- Feature `document_storage` habilitada para la org demo
- Contenedor de MinIO detenido (`docker stop docuia-minio`)

**Pasos:**
1. Iniciar sesión como `carlos@acme.mx`
2. Ir a /workflow
3. Subir un archivo PDF válido

**Resultado esperado:**
- La pipeline falla en el paso de `uploadFile`
- El documento queda con `status = "failed"` en la base de datos
- Se crea una entrada en `exception_queue`
- La respuesta HTTP retorna `{ ok: false, error: "...", documentId: N }` con status 500

---

---

# MÓDULO 2 — Autenticación Tenant

---

### [TC-010] Login exitoso con credenciales válidas

**Tipo:** P  
**Prioridad:** Alta

**Pasos:**
1. Ir a `/login`
2. Ingresar email `carlos@acme.mx`, contraseña `Demo1234!`
3. Hacer clic en "Iniciar sesión"

**Resultado esperado:**
- Respuesta HTTP 200 con `{ ok: true }`
- Cookie `access_token` (httpOnly, maxAge 900s) establecida
- Cookie `refresh_token` (httpOnly, maxAge 604800s) establecida
- Redirección a `/dashboard`
- Entrada creada en tabla `auth_sessions` con `user_type = "org_user"`
- Entrada en tabla `audit_log` con `action = "login"`

---

### [TC-011] Login con contraseña incorrecta

**Tipo:** N  
**Prioridad:** Alta

**Pasos:**
1. Ir a `/login`
2. Ingresar email `carlos@acme.mx`, contraseña `Incorrecta123`
3. Hacer clic en "Iniciar sesión"

**Resultado esperado:**
- HTTP 401
- `{ error: "Credenciales inválidas" }`
- No se crean cookies ni sesión en DB
- El contador del rate limiter para la IP se incrementa

---

### [TC-012] Login con email inexistente

**Tipo:** N  
**Prioridad:** Alta

**Pasos:**
1. Ir a `/login`
2. Ingresar email `noexiste@acme.mx`, contraseña `cualquiera`

**Resultado esperado:**
- HTTP 401
- `{ error: "Credenciales inválidas" }` (mismo mensaje que contraseña incorrecta — sin enumeración de usuarios)

---

### [TC-013] Login con usuario inactivo

**Tipo:** N  
**Prioridad:** Alta

**Precondiciones:**
- Crear un usuario con `is_active = false` en la DB o desactivar uno existente directamente en PostgreSQL

**Pasos:**
1. Intentar hacer login con las credenciales del usuario inactivo

**Resultado esperado:**
- HTTP 401
- `{ error: "Credenciales inválidas" }`

---

### [TC-014] Rate limiting en login — más de 5 intentos fallidos

**Tipo:** N  
**Prioridad:** Alta

**Pasos:**
1. Desde la misma IP, hacer 5 peticiones POST a `/api/v1/auth/login` con contraseñas incorrectas
2. Realizar el 6to intento

**Resultado esperado:**
- Los primeros 5 intentos retornan HTTP 401
- El 6to intento retorna HTTP 429 con header `Retry-After`
- Body: `{ error: "Demasiados intentos. Inténtalo en X min." }`
- El contador se limpia tras login exitoso (verificar que un login válido posterior restablece el acceso)

---

### [TC-015] Rate limiting se resetea tras login exitoso

**Tipo:** B  
**Prioridad:** Media

**Pasos:**
1. Realizar 4 intentos de login fallidos desde una IP
2. Realizar un login exitoso con credenciales válidas desde la misma IP
3. Verificar que el rate limit fue limpiado

**Resultado esperado:**
- El login exitoso retorna HTTP 200
- Un intento posterior (con credenciales incorrectas) retorna HTTP 401 (no 429), indicando que el contador fue reiniciado

---

### [TC-016] Token de acceso expirado redirige al login

**Tipo:** N  
**Prioridad:** Alta

**Pasos:**
1. Iniciar sesión correctamente
2. Modificar manualmente la cookie `access_token` para que sea un JWT expirado (o esperar 15 minutos si la prueba lo permite)
3. Intentar navegar a `/dashboard`

**Resultado esperado:**
- El middleware detecta el token inválido
- Borra ambas cookies (`access_token`, `refresh_token`)
- Redirige a `/login`

---

### [TC-017] Refresh de token válido

**Tipo:** P  
**Prioridad:** Alta

**Pasos:**
1. Iniciar sesión correctamente
2. Enviar POST a `/api/v1/auth/refresh` con la cookie `refresh_token` válida

**Resultado esperado:**
- HTTP 200 con `{ ok: true }`
- Nueva cookie `access_token` establecida
- Nueva cookie `refresh_token` establecida con nuevo nonce
- El campo `refresh_token` en `auth_sessions` se actualiza al nuevo nonce

---

### [TC-018] Detección de reutilización de refresh token

**Tipo:** N  
**Prioridad:** Alta

**Pasos:**
1. Iniciar sesión y capturar el `refresh_token` original (cookie)
2. Llamar a `/api/v1/auth/refresh` una primera vez — obtener nuevas cookies
3. Volver a enviar el `refresh_token` **original** (el ya rotado) a `/api/v1/auth/refresh`

**Resultado esperado:**
- HTTP 401 con `{ error: "Sesión inválida. Inicia sesión nuevamente." }`
- **Todas** las sesiones del usuario son revocadas (campo `revoked_at` poblado en `auth_sessions`)
- Indica que el token anterior fue comprometido

---

### [TC-019] Refresh token para sesión revocada

**Tipo:** N  
**Prioridad:** Alta

**Pasos:**
1. Iniciar sesión correctamente
2. En la DB, actualizar `revoked_at = NOW()` para la sesión activa
3. Enviar POST a `/api/v1/auth/refresh`

**Resultado esperado:**
- HTTP 401 con `{ error: "Sesión expirada" }`

---

### [TC-020] Logout limpia sesión

**Tipo:** P  
**Prioridad:** Alta

**Pasos:**
1. Iniciar sesión correctamente
2. Enviar POST a `/api/v1/auth/logout`
3. Intentar acceder a `/dashboard`

**Resultado esperado:**
- El logout retorna HTTP 200
- La sesión en `auth_sessions` queda con `revoked_at` poblado
- El intento de acceder a `/dashboard` redirige a `/login`

---

### [TC-021] Admin intenta acceder a ruta tenant con token admin

**Tipo:** N  
**Prioridad:** Alta

**Pasos:**
1. Iniciar sesión como `admin@docuia.com` en `/admin/login`
2. Intentar navegar directamente a `/dashboard`

**Resultado esperado:**
- El middleware verifica el tipo del token; `platform_admin` no tiene `type = "org_user"`
- Borra cookies y redirige a `/login`

---

### [TC-022] Usuario autenticado es redirigido desde /login

**Tipo:** B  
**Prioridad:** Baja

**Pasos:**
1. Iniciar sesión correctamente como tenant
2. Intentar navegar manualmente a `/login`

**Resultado esperado:**
- El middleware detecta el token `org_user` válido
- Redirige automáticamente a `/dashboard`

---

---

# MÓDULO 3 — Autenticación Admin

---

### [TC-030] Login admin exitoso

**Tipo:** P  
**Prioridad:** Alta

**Pasos:**
1. Ir a `/admin/login`
2. Ingresar `admin@docuia.com` / `DocuIA2024!`

**Resultado esperado:**
- HTTP 200 con `{ ok: true }`
- Cookie `access_token` con payload `type = "platform_admin"`
- Redirección a `/admin`
- Campo `last_login_at` actualizado en `platform_admins`

---

### [TC-031] Login admin con contraseña incorrecta

**Tipo:** N  
**Prioridad:** Alta

**Pasos:**
1. Ir a `/admin/login`
2. Ingresar credenciales incorrectas

**Resultado esperado:**
- HTTP 401 con `{ error: "Credenciales inválidas" }`

---

### [TC-032] Tenant intenta acceder a ruta admin

**Tipo:** N  
**Prioridad:** Alta

**Pasos:**
1. Iniciar sesión como `carlos@acme.mx`
2. Intentar navegar a `/admin`

**Resultado esperado:**
- El middleware detecta `type = "org_user"`, no `platform_admin`
- Borra cookies y redirige a `/admin/login`

---

### [TC-033] Acceso a /admin sin token

**Tipo:** N  
**Prioridad:** Alta

**Pasos:**
1. Sin ninguna cookie de sesión
2. Intentar navegar a `/admin/clients`

**Resultado esperado:**
- Redirige a `/admin/login`

---

### [TC-034] Admin autenticado redirigido desde /admin/login

**Tipo:** B  
**Prioridad:** Baja

**Pasos:**
1. Iniciar sesión como admin
2. Navegar a `/admin/login`

**Resultado esperado:**
- Redirige a `/admin`

---

### [TC-035] Rate limiting en login admin

**Tipo:** N  
**Prioridad:** Alta

**Pasos:**
1. Hacer 5 intentos fallidos a `POST /api/admin/auth/login` desde la misma IP
2. Intentar el 6to

**Resultado esperado:**
- HTTP 429 con header `Retry-After` (15 minutos = 900 segundos)

---

### [TC-036] Admin logout

**Tipo:** P  
**Prioridad:** Alta

**Pasos:**
1. Iniciar sesión como admin
2. Enviar POST a `/api/admin/auth/logout`
3. Intentar acceder a `/admin`

**Resultado esperado:**
- Sesión revocada en DB
- Redirige a `/admin/login`

---

---

# MÓDULO 4 — Recuperación de Contraseña

---

### [TC-040] Solicitar reset con email válido

**Tipo:** P  
**Prioridad:** Alta

**Pasos:**
1. Ir a `/forgot-password`
2. Ingresar `carlos@acme.mx`
3. Enviar formulario

**Resultado esperado:**
- HTTP 200 con `{ ok: true, message: "Si el email existe, recibirás un enlace de recuperación." }`
- Campo `reset_token` y `reset_token_expires_at` (1 hora en el futuro) guardados en `org_users`
- Email enviado (verificar en logs de consola si `RESEND_API_KEY` no está configurado)

---

### [TC-041] Solicitar reset con email inexistente (anti-enumeración)

**Tipo:** P  
**Prioridad:** Alta

**Pasos:**
1. Ir a `/forgot-password`
2. Ingresar `noexiste@empresa.com`

**Resultado esperado:**
- HTTP 200 con el **mismo mensaje** que TC-040
- No se modifica ningún registro en DB
- No se envía email

**Nota:** La respuesta idéntica es intencional para prevenir enumeración de usuarios.

---

### [TC-042] Reset con token válido

**Tipo:** P  
**Prioridad:** Alta

**Precondiciones:** TC-040 completado; token capturado de la DB o del log de consola

**Pasos:**
1. Navegar a `/reset-password?token=<TOKEN_VALIDO>`
2. Ingresar nueva contraseña `NuevaPass123!`
3. Confirmar y enviar

**Resultado esperado:**
- HTTP 200 exitoso
- `password_hash` actualizado en `org_users`
- `reset_token` y `reset_token_expires_at` limpiados a NULL
- Redirección a `/login` con mensaje de éxito

---

### [TC-043] Reset con token expirado

**Tipo:** N  
**Prioridad:** Alta

**Precondiciones:**
- En la DB, crear un token con `reset_token_expires_at` en el pasado

**Pasos:**
1. Navegar a `/reset-password?token=<TOKEN_EXPIRADO>`
2. Intentar cambiar contraseña

**Resultado esperado:**
- Error indicando que el token expiró o es inválido
- Contraseña no cambiada

---

### [TC-044] Reset con token inválido / inexistente

**Tipo:** N  
**Prioridad:** Alta

**Pasos:**
1. Navegar a `/reset-password?token=tokenfalso123`

**Resultado esperado:**
- Error de token inválido
- No se modifica ningún registro

---

---

# MÓDULO 5 — Panel de Admin — Dashboard y Clientes

---

### [TC-050] Dashboard de admin muestra KPIs reales

**Tipo:** P  
**Prioridad:** Media

**Precondiciones:** Sesión de admin activa; seeds ejecutados con datos demo

**Pasos:**
1. Ir a `/admin`
2. Observar los widgets de KPI

**Resultado esperado:**
- Se muestran: conteo de organizaciones, documentos procesados hoy, tasa de fallback de AI, health score promedio
- Los valores son numéricos y provienen de consultas reales a la DB (no son datos estáticos)

---

### [TC-051] Listar clientes con búsqueda

**Tipo:** P  
**Prioridad:** Media

**Pasos:**
1. Ir a `/admin/clients`
2. Observar la tabla de clientes
3. Escribir "Acme" en el campo de búsqueda

**Resultado esperado:**
- Se muestra la lista completa al cargar
- Al filtrar, solo aparece "Distribuidora Acme"
- La búsqueda es insensible a mayúsculas

---

### [TC-052] Ver detalle de cliente

**Tipo:** P  
**Prioridad:** Media

**Pasos:**
1. Ir a `/admin/clients`
2. Hacer clic en "Distribuidora Acme"
3. Navegar a `/admin/clients/<id>`

**Resultado esperado:**
- Se muestran: nombre de org, plan, estado, subsidiarias, usuarios, logs de actividad reciente
- La URL contiene el ID de la organización

---

### [TC-053] Editar datos de cliente

**Tipo:** P  
**Prioridad:** Media

**Pasos:**
1. En `/admin/clients/<id>`, hacer clic en editar
2. Cambiar el nombre de la organización
3. Guardar

**Resultado esperado:**
- PATCH a la API retorna HTTP 200
- El nuevo nombre aparece reflejado en la UI
- El cambio se persiste en la tabla `organizations`

---

### [TC-054] Descargar SuiteScripts

**Tipo:** P  
**Prioridad:** Media

**Pasos:**
1. En `/admin/clients/<id>`, buscar la sección de SuiteScripts
2. Hacer clic en el link de descarga de un script

**Resultado esperado:**
- El navegador descarga un archivo `.js`
- El archivo contiene el código del RESTlet personalizado para el cliente

---

### [TC-055] Credenciales NS se almacenan cifradas

**Tipo:** P  
**Prioridad:** Alta

**Pasos:**
1. Completar el wizard de NetSuite con credenciales válidas para un cliente
2. Consultar directamente en PostgreSQL: `SELECT consumer_key FROM ns_connections WHERE organization_id = '<id>'`

**Resultado esperado:**
- El valor en la DB NO es texto plano; es una cadena cifrada AES-256-GCM
- El formato esperado es el resultado de `encryptField()` (string hexadecimal con IV)

---

### [TC-056] Crear cliente sin nombre

**Tipo:** N  
**Prioridad:** Media

**Pasos:**
1. Ir a `/admin/clients/new`
2. Intentar guardar sin completar el campo "Nombre"

**Resultado esperado:**
- Validación de formulario impide el envío
- Mensaje de error indicando que el nombre es requerido

---

### [TC-057] Acceder al detalle de cliente inexistente

**Tipo:** N  
**Prioridad:** Media

**Pasos:**
1. Navegar a `/admin/clients/uuid-que-no-existe`

**Resultado esperado:**
- HTTP 404 o redirección a la lista de clientes
- No se produce error 500

---

---

# MÓDULO 6 — Panel de Admin — Feature Flags

---

### [TC-060] Listar features en la pantalla de administración

**Tipo:** P  
**Prioridad:** Media

**Pasos:**
1. Ir a `/admin/features`

**Resultado esperado:**
- Se listan los 25 features del sistema con su nombre, categoría, plan requerido y estado por defecto
- Cada feature tiene su descripción

---

### [TC-061] Habilitar feature para organización específica

**Tipo:** P  
**Prioridad:** Alta

**Pasos:**
1. Ir a `/admin/clients/<id-acme>`
2. Localizar la feature `bulk_upload` (desactivada por defecto para el tenant)
3. Activarla via toggle

**Resultado esperado:**
- PATCH a `/api/admin/clients/<id>/features/bulk_upload` con `{ isEnabled: true }`
- HTTP 200 con `{ ok: true }`
- La UI del toggle actualiza su estado visualmente
- Se crea una entrada en `admin_audit_log` con `action = "toggle_feature"`
- Al recargar `/workflow` como el tenant, el botón de "Subir varios" ahora es visible

---

### [TC-062] Deshabilitar feature y verificar gate de UI

**Tipo:** P  
**Prioridad:** Alta

**Pasos:**
1. Como admin, deshabilitar la feature `exception_queue` para la org de Acme
2. Iniciar sesión como `carlos@acme.mx`
3. Observar el sidebar

**Resultado esperado:**
- El link a `/exceptions` ya no aparece en el sidebar
- Si se navega directamente a `/exceptions`, la página sigue siendo accesible (el gate es solo de UI — ver nota de FASE 2)

---

### [TC-063] Intentar toggle de feature sin sesión admin

**Tipo:** N  
**Prioridad:** Alta

**Pasos:**
1. Sin cookies de admin, enviar PATCH a `/api/admin/clients/<id>/features/bulk_upload`

**Resultado esperado:**
- HTTP 401 con `{ error: "Unauthorized" }` o similar
- No se modifica ningún feature

---

### [TC-064] Intentar toggle de feature con sesión tenant (no admin)

**Tipo:** N  
**Prioridad:** Alta

**Pasos:**
1. Iniciar sesión como `carlos@acme.mx` (tenant)
2. Enviar PATCH a `/api/admin/clients/<id>/features/bulk_upload`

**Resultado esperado:**
- HTTP 401 o 403
- El endpoint requiere `platform_admin`, no `org_user`

---

### [TC-065] Feature con config JSON — guardar configuración

**Tipo:** P  
**Prioridad:** Media

**Pasos:**
1. Como admin, abrir la feature `data_retention` para una org
2. Guardar con configuración `{ "history_retention_days": 30, "logs_retention_days": 90 }`

**Resultado esperado:**
- La configuración se persiste en `org_features.config_json`
- La función `getFeature()` retorna la configuración mergeada con los defaults

---

---

# MÓDULO 7 — Wizard NetSuite (Admin)

---

### [TC-070] Wizard 7 pasos — flujo completo exitoso

**Tipo:** P  
**Prioridad:** Alta

**Precondiciones:** Credenciales NS de sandbox disponibles

**Pasos:**
1. Como admin, ir a `/admin/clients/<id>`
2. Iniciar el wizard de configuración NetSuite
3. Paso 1: Ingresar Account ID (ej: `TSTDRV1234567-SB1`)
4. Paso 2: Ingresar Consumer Key, Consumer Secret
5. Paso 3: Ingresar Token ID, Token Secret
6. Paso 4: Ingresar Script ID y Deploy ID del script de catálogo
7. Paso 5: Ingresar Script ID y Deploy ID del script de proceso
8. Paso 6: Probar conexión
9. Paso 7: Configurar subsidiarias y guardar

**Resultado esperado:**
- Cada paso valida antes de avanzar
- El paso 6 (test) hace GET a la REST API de NS y retorna `{ ok: true }`
- Al guardar, las credenciales se cifran con AES-256-GCM y se persisten en `ns_connections`
- Subsidiarias se guardan en tabla `subsidiaries`

---

### [TC-071] Test de conexión con credenciales válidas

**Tipo:** P  
**Prioridad:** Alta

**Pasos:**
1. Con credenciales NS válidas configuradas, hacer POST a `/api/admin/ns/test-connection`

**Resultado esperado:**
- HTTP 200 con `{ ok: true, data: { accountId: "..." }, status: 200 }`
- Si NS retorna 403 (acceso a registro sin permiso), también se considera válido

---

### [TC-072] Test de conexión con Account ID incorrecto

**Tipo:** N  
**Prioridad:** Alta

**Pasos:**
1. Ingresar un Account ID que no existe (ej: `INVALIDO1234`)
2. Intentar probar la conexión

**Resultado esperado:**
- `{ ok: false, error: "HTTP 4xx: ..." }`
- El wizard muestra mensaje de error y no avanza al siguiente paso

---

### [TC-073] Test de conexión con token incorrecto

**Tipo:** N  
**Prioridad:** Alta

**Pasos:**
1. Con Account ID válido pero Token Secret incorrecto
2. Intentar probar la conexión

**Resultado esperado:**
- NS retorna 401 o 403 con "Invalid login credentials"
- `{ ok: false, error: "HTTP 401: ..." }`

---

### [TC-074] Probe de script de catálogo

**Tipo:** P  
**Prioridad:** Alta

**Pasos:**
1. Con credenciales válidas y Script/Deploy ID del catálogo correctos
2. Llamar a `POST /api/admin/ns/probe-scripts`

**Resultado esperado:**
- `{ ok: true, data: { version: "..." } }`
- El RESTlet responde al `type=ping` correctamente

---

### [TC-075] Probe de script con Deploy ID incorrecto

**Tipo:** N  
**Prioridad:** Alta

**Pasos:**
1. Con Script ID válido pero Deploy ID incorrecto
2. Llamar a probe-scripts

**Resultado esperado:**
- NS retorna error (RCRD_NOT_FOUND o similar)
- `{ ok: false, error: "HTTP 4xx: ..." }`

---

### [TC-076] Obtener subsidiarias vía RESTlet

**Tipo:** P  
**Prioridad:** Alta

**Pasos:**
1. Con conexión válida configurada
2. Llamar a `POST /api/admin/ns/subsidiaries`

**Resultado esperado:**
- `{ ok: true, data: [ { internal_id: "...", name: "...", country: "MX", currency: "MXN" }, ... ] }`

---

---

# MÓDULO 8 — Portal Tenant — Dashboard

---

### [TC-080] Dashboard muestra KPIs reales del tenant

**Tipo:** P  
**Prioridad:** Media

**Pasos:**
1. Iniciar sesión como `carlos@acme.mx`
2. Ir a `/dashboard`

**Resultado esperado:**
- Se muestran: documentos del mes, excepciones activas, mapeos configurados
- La tabla "Documentos recientes" lista los últimos documentos de la organización
- Los datos son de la org de Acme (no de otras orgs)

---

### [TC-081] Dashboard no muestra datos de otras organizaciones

**Tipo:** N  
**Prioridad:** Alta

**Pasos:**
1. Crear una segunda organización con sus propios documentos
2. Iniciar sesión como usuario de la primera org
3. Verificar que el dashboard no mezcla datos

**Resultado esperado:**
- Las consultas a la DB incluyen `WHERE organization_id = session.orgId`
- Solo se muestran datos de la organización del usuario autenticado

---

### [TC-082] Dashboard con organización sin documentos

**Tipo:** P  
**Prioridad:** Baja

**Pasos:**
1. Crear una nueva org sin documentos
2. Iniciar sesión con un usuario de esa org
3. Ir a `/dashboard`

**Resultado esperado:**
- KPIs muestran cero
- La tabla de documentos recientes muestra estado vacío (no error 500)

---

### [TC-083] Acceso a dashboard sin sesión

**Tipo:** N  
**Prioridad:** Alta

**Pasos:**
1. Sin cookies de sesión, navegar a `/dashboard`

**Resultado esperado:**
- Middleware redirige a `/login`

---

---

# MÓDULO 9 — Portal Tenant — Workflow / Upload

---

### [TC-090] Subida de PDF — flujo completo con auto-proceso

**Tipo:** P  
**Prioridad:** Alta

**Precondiciones:**
- `netsuite_dry_run` habilitado para Acme (para evitar crear registros reales en NS)
- `ai_tiered_fallback` habilitado
- Subsidiaria válida configurada
- Threshold de auto-proceso en 50% (para facilitar que el auto-proceso se active)
- Archivo PDF de una factura con proveedor y líneas claras

**Pasos:**
1. Ir a `/workflow`
2. Seleccionar tipo "Factura"
3. Seleccionar la subsidiaria de Acme
4. Subir un PDF de factura
5. Esperar respuesta

**Resultado esperado:**
- `{ ok: true, status: "completed", documentId: N, netsuiteId: "...", recordUrl: "..." }`
- Con dry_run activo, NS retorna éxito simulado sin crear registro real
- `history_documents` muestra `status = "completed"`
- `storage_key` poblado si `document_storage` está habilitado

---

### [TC-091] Subida de XML CFDI

**Tipo:** P  
**Prioridad:** Alta

**Pasos:**
1. En `/workflow`, seleccionar tipo "CFDI XML"
2. Subir un archivo XML CFDI válido (con nodo `cfdi:Comprobante`)

**Resultado esperado:**
- La extracción usa el parser CFDI local (no Gemini)
- `extraction.model` es `"cfdi-parser"`
- Los campos UUID, RFC emisor, total, líneas se extraen correctamente
- `fallback_used = false`, `prompt_tokens = 0`

---

### [TC-092] Subida que va a revisión (confianza baja)

**Tipo:** P  
**Prioridad:** Alta

**Precondiciones:**
- Threshold de auto-proceso en 100% (para forzar revisión)
- Documento con proveedor que no existe en el catálogo

**Pasos:**
1. Subir un PDF donde el proveedor no existe en el catálogo NS
2. Observar la respuesta

**Resultado esperado:**
- `{ ok: true, status: "review", documentId: N, payload: {...} }`
- `history_documents.status = "review"`
- `products` JSON guardado con el payload del UI para revisión posterior
- Webhook `document.review` disparado (si webhooks configurados)

---

### [TC-093] Subida con approval_workflow habilitado

**Tipo:** P  
**Prioridad:** Alta

**Precondiciones:**
- `approval_workflow` habilitado para Acme
- Threshold de auto-proceso configurado para que el documento pase el threshold

**Pasos:**
1. Subir un PDF con alta confianza (proveedor y líneas existentes en catálogo)

**Resultado esperado:**
- `{ ok: true, status: "pending_approval", documentId: N }`
- `history_documents.status = "pending_approval"`
- El documento **no** se envía automáticamente a NetSuite

---

### [TC-094] Aprobar documento en pending_approval (como admin)

**Tipo:** P  
**Prioridad:** Alta

**Precondiciones:** TC-093 completado; documento en `pending_approval`

**Pasos:**
1. Iniciar sesión como usuario con `role = "admin"`
2. Enviar POST a `/api/v1/workflow/<docId>/approve`

**Resultado esperado:**
- HTTP 200 con `{ ok: true, netsuiteId: "...", recordUrl: "..." }`
- `history_documents.status = "completed"`
- `approved_by` poblado con el ID del admin
- NS recibe el payload (o dry run si activo)

---

### [TC-095] Intentar aprobar sin rol admin

**Tipo:** N  
**Prioridad:** Alta

**Precondiciones:** Documento en `pending_approval`; usuario con role `operator`

**Pasos:**
1. Iniciar sesión como operador
2. Enviar POST a `/api/v1/workflow/<docId>/approve`

**Resultado esperado:**
- HTTP 403 con `{ error: "Se requiere rol de administrador" }`
- El documento permanece en `pending_approval`

---

### [TC-096] Subida sin archivo adjunto

**Tipo:** N  
**Prioridad:** Alta

**Pasos:**
1. Enviar POST a `/api/v1/workflow/upload` sin campo `file` en el formData

**Resultado esperado:**
- HTTP 400 con `{ error: "Se requiere un archivo" }`

---

### [TC-097] Subida sin subsidiaryId

**Tipo:** N  
**Prioridad:** Alta

**Pasos:**
1. Enviar POST a `/api/v1/workflow/upload` con archivo PDF pero sin `subsidiaryId`

**Resultado esperado:**
- HTTP 400 con `{ error: "Se requiere subsidiaryId" }`

---

### [TC-098] Tipo de archivo no permitido

**Tipo:** N  
**Prioridad:** Alta

**Pasos:**
1. Subir un archivo `.docx` o `.xlsx`

**Resultado esperado:**
- HTTP 415 con `{ error: "Tipo de archivo no permitido: application/vnd.openxmlformats-officedocument..." }`
- Tipos permitidos: PDF, JPEG, PNG, WEBP, TIFF, XML

---

### [TC-099] Archivo excede 20 MB

**Tipo:** N  
**Prioridad:** Alta

**Pasos:**
1. Intentar subir un PDF de más de 20 MB

**Resultado esperado:**
- HTTP 413 con `{ error: "El archivo excede el límite de 20 MB" }`

---

### [TC-100] Subsidiaria que no pertenece a la organización

**Tipo:** N  
**Prioridad:** Alta

**Pasos:**
1. Enviar POST a `/api/v1/workflow/upload` con un `subsidiaryId` de otra organización

**Resultado esperado:**
- HTTP 404 con `{ error: "Subsidiaria no válida" }`
- La verificación usa `AND subsidiaries.organization_id = session.orgId`

---

### [TC-101] Subida masiva con bulk_upload deshabilitado

**Tipo:** N  
**Prioridad:** Alta

**Precondiciones:** Feature `bulk_upload` deshabilitada para la org

**Pasos:**
1. Enviar POST a `/api/v1/workflow/upload` con `bulk=true` en el formData

**Resultado esperado:**
- HTTP 403 con `{ error: "La carga masiva no está disponible en tu plan" }`
- **Este es uno de los dos endpoints con gate de servidor implementado en Fase 1**

---

### [TC-102] Detección de duplicado

**Tipo:** N  
**Prioridad:** Alta

**Precondiciones:** Feature `duplicate_detection` habilitada; ya existe un documento con `vendor = "Proveedor X"` y `num_doc = "FACT-001"` en estado no fallido

**Pasos:**
1. Subir un segundo documento del mismo proveedor con el mismo número de factura

**Resultado esperado:**
- La pipeline arroja error `"Factura duplicada: Proveedor X #FACT-001 ya existe (doc #N)"`
- `history_documents.status = "failed"`
- Se crea entrada en `exception_queue` con `failure_stage = "validate"`

---

### [TC-103] Pipeline con document_storage deshabilitado

**Tipo:** B  
**Prioridad:** Media

**Precondiciones:** Feature `document_storage` deshabilitada

**Pasos:**
1. Subir un documento cualquiera

**Resultado esperado:**
- La pipeline **no** llama a `uploadFile()` (MinIO no es invocado)
- `history_documents.storage_key` queda `NULL`
- El resto de la pipeline continúa normalmente

---

### [TC-104] Pipeline con ai_force_secondary habilitado

**Tipo:** B  
**Prioridad:** Media

**Precondiciones:** Feature `ai_force_secondary` habilitada

**Pasos:**
1. Subir un PDF de factura (no XML CFDI)

**Resultado esperado:**
- La extracción se realiza con el modelo secundario (Gemini Pro) directamente, sin intentar el primario
- `history_documents.extraction_engine` refleja el modelo secundario
- `fallback_used = true`

---

---

# MÓDULO 10 — Portal Tenant — Historial

---

### [TC-110] Ver lista de documentos en historial

**Tipo:** P  
**Prioridad:** Media

**Pasos:**
1. Ir a `/history`

**Resultado esperado:**
- Se listan todos los documentos de la org con: tipo, proveedor, número, total, estado, fecha
- Los documentos de otras organizaciones no aparecen

---

### [TC-111] Ver detalle de documento

**Tipo:** P  
**Prioridad:** Media

**Pasos:**
1. En `/history`, hacer clic en un documento completado

**Resultado esperado:**
- Se muestra el detalle completo: extracción, líneas, estado de mapeo, NetSuite Doc ID, URL de NS
- Botón de enlace a NetSuite visible si `url_netsuite` está poblado

---

### [TC-112] Exportar CSV con feature habilitada

**Tipo:** P  
**Prioridad:** Alta

**Precondiciones:** Feature `data_export` habilitada

**Pasos:**
1. Ir a `/history`
2. Hacer clic en "Exportar CSV"

**Resultado esperado:**
- GET a `/api/v1/history/export`
- HTTP 200 con `Content-Type: text/csv`
- `Content-Disposition: attachment; filename="historial-YYYY-MM-DD.csv"`
- El CSV contiene las columnas: ID, Tipo, Proveedor, Num. Doc, Total, Estado, NS Doc ID, Creado, Actualizado

---

### [TC-113] Exportar CSV con feature deshabilitada

**Tipo:** N  
**Prioridad:** Alta

**Precondiciones:** Feature `data_export` deshabilitada

**Pasos:**
1. El botón "Exportar CSV" no debe aparecer en la UI (gate de UI)
2. Si se envía GET directo a `/api/v1/history/export`

**Resultado esperado:**
- El botón está oculto en la UI (gate visual)
- La llamada directa a la API retorna HTTP 403 con `{ error: "Feature no disponible" }`
- **Este es el segundo endpoint con gate de servidor implementado en Fase 1**

---

### [TC-114] Ver detalle de documento de otra organización

**Tipo:** N  
**Prioridad:** Alta

**Pasos:**
1. Obtener el ID de un documento de otra organización
2. Navegar a `/history/<id-de-otra-org>`

**Resultado esperado:**
- La API retorna HTTP 404 (el documento no existe para esta org)
- No hay fuga de datos entre organizaciones

---

### [TC-115] Documento en revisión muestra formulario de edición

**Tipo:** P  
**Prioridad:** Alta

**Precondiciones:** Existe un documento con `status = "review"`

**Pasos:**
1. Ir a `/history/<docId>` donde el doc está en revisión
2. Verificar que se renderiza el componente `review-client.tsx`

**Resultado esperado:**
- Formulario editable con líneas del documento
- Campo de selección de proveedor NS
- Botón "Enviar a NetSuite"
- Cada línea permite cambiar el ítem NS, cantidad y precio

---

### [TC-116] Documento pending_approval muestra acciones de admin

**Tipo:** P  
**Prioridad:** Alta

**Precondiciones:** Documento con `status = "pending_approval"`; usuario con role admin

**Pasos:**
1. Ir a `/history/<docId>`

**Resultado esperado:**
- Se renderiza `pending-approval-client.tsx`
- Botones "Aprobar" y "Rechazar" visibles
- Botón "Aprobar" ejecuta POST a `/api/v1/workflow/<docId>/approve`

---

---

# MÓDULO 11 — Portal Tenant — Cola de Excepciones

---

### [TC-120] Ver excepciones activas

**Tipo:** P  
**Prioridad:** Media

**Precondiciones:** Existen documentos fallidos en `exception_queue`

**Pasos:**
1. Ir a `/exceptions`

**Resultado esperado:**
- Se listan las excepciones con: tipo de documento, nombre de archivo, razón del fallo, etapa del fallo, fecha, estado
- Se muestran las opciones de "Reintentar" y "Resolver"

---

### [TC-121] Reintentar excepción con archivo en storage

**Tipo:** P  
**Prioridad:** Alta

**Precondiciones:**
- Excepción con `storage_key` válido (archivo guardado en MinIO)
- La causa original del fallo fue corregida (ej: credenciales NS actualizadas)

**Pasos:**
1. Hacer clic en "Reintentar" para una excepción
2. POST a `/api/v1/exceptions/<id>/retry`

**Resultado esperado:**
- La excepción pasa a estado `in_progress`
- `retry_count` se incrementa
- Se re-ejecuta la pipeline con el archivo del storage
- Si tiene éxito, la excepción pasa a `resolved`
- Si falla de nuevo, vuelve a `pending` con el nuevo error

---

### [TC-122] Reintentar excepción sin archivo en storage

**Tipo:** N  
**Prioridad:** Alta

**Precondiciones:** Excepción con `storage_key = NULL`

**Pasos:**
1. Intentar reintentar la excepción

**Resultado esperado:**
- HTTP 422 con `{ error: "No hay archivo asociado para reintentar" }`

---

### [TC-123] Resolver excepción manualmente

**Tipo:** P  
**Prioridad:** Media

**Pasos:**
1. En `/exceptions`, hacer clic en "Resolver" para una excepción pendiente
2. POST a `/api/v1/exceptions/<id>/resolve`

**Resultado esperado:**
- La excepción pasa a estado `resolved` o `dismissed`
- Ya no aparece en la lista de excepciones activas

---

### [TC-124] Reintentar excepción ya resuelta

**Tipo:** N  
**Prioridad:** Media

**Pasos:**
1. Intentar reintentar una excepción con `status = "resolved"`

**Resultado esperado:**
- HTTP 409 con `{ error: "Esta excepción ya fue resuelta" }`

---

### [TC-125] Reintentar excepción de otra organización

**Tipo:** N  
**Prioridad:** Alta

**Pasos:**
1. Obtener el ID de una excepción de otra org
2. Enviar POST a `/api/v1/exceptions/<id>/retry`

**Resultado esperado:**
- HTTP 404 (la excepción no existe para esta org)
- El query incluye `AND organization_id = session.orgId`

---

### [TC-126] Excepción sin subsidiaria definida

**Tipo:** N  
**Prioridad:** Media

**Precondiciones:** Excepción con `subsidiary_id = NULL`

**Pasos:**
1. Intentar reintentar la excepción

**Resultado esperado:**
- HTTP 422 con `{ error: "Subsidiaria no definida en esta excepción" }`

---

---

# MÓDULO 12 — Portal Tenant — Mapeos y Catálogos

---

### [TC-130] Acceder a mapeos con feature habilitada

**Tipo:** P  
**Prioridad:** Media

**Precondiciones:** Feature `auto_mapping` habilitada

**Pasos:**
1. Ir a `/mappings`

**Resultado esperado:**
- Página carga con la tabla de mapeos configurados
- El link a `/mappings` está visible en el sidebar

---

### [TC-131] Sidebar oculta mapeos con feature deshabilitada

**Tipo:** N  
**Prioridad:** Alta

**Precondiciones:** Feature `auto_mapping` deshabilitada

**Pasos:**
1. Iniciar sesión como tenant
2. Observar el sidebar

**Resultado esperado:**
- El link a `/mappings` NO aparece en el sidebar
- Si se navega directamente a `/mappings`, la página aún carga (solo gate de UI)

---

### [TC-132] Acceder a catálogos y ver ítems sincronizados

**Tipo:** P  
**Prioridad:** Media

**Precondiciones:** Catálogos sincronizados via admin sync

**Pasos:**
1. Ir a `/catalogs`
2. Seleccionar la subsidiaria de Acme
3. Navegar entre pestañas: Ítems, Proveedores, Ubicaciones

**Resultado esperado:**
- Se listan los ítems/proveedores/ubicaciones sincronizados desde NetSuite
- Los datos incluyen internalId, nombre, tipo/RFC/full name según corresponda

---

### [TC-133] Catálogos vacíos cuando no hay sincronización

**Tipo:** P  
**Prioridad:** Baja

**Precondiciones:** Sin datos en tablas `catalog_items`, `catalog_vendors`, `catalog_locations`

**Pasos:**
1. Ir a `/catalogs`

**Resultado esperado:**
- Estado vacío con mensaje instructivo (no error 500)

---

---

# MÓDULO 13 — Portal Tenant — Estadísticas

---

### [TC-140] Acceder a estadísticas con feature habilitada

**Tipo:** P  
**Prioridad:** Media

**Precondiciones:** Feature `advanced_analytics` habilitada

**Pasos:**
1. Ir a `/statistics`

**Resultado esperado:**
- Página carga con gráficas y métricas
- El link a `/statistics` está visible en el sidebar

---

### [TC-141] Sidebar oculta estadísticas con feature deshabilitada

**Tipo:** N  
**Prioridad:** Alta

**Precondiciones:** Feature `advanced_analytics` deshabilitada

**Pasos:**
1. Iniciar sesión como tenant
2. Observar el sidebar

**Resultado esperado:**
- El link a `/statistics` NO aparece en el sidebar

---

### [TC-142] API de stats no verifica feature en servidor — FASE 2

**Tipo:** N  
**Prioridad:** Baja  
**Estado:** `[FASE 2 — NO EJECUTAR]`

**Descripción:**
El endpoint `/api/v1/stats` existe pero actualmente **no verifica** si `advanced_analytics` está habilitado del lado del servidor. Llamar directamente a la API retorna datos aunque la feature esté deshabilitada.

**Resultado esperado cuando se implemente:**
- HTTP 403 si la feature está deshabilitada

---

---

# MÓDULO 14 — Portal Tenant — Configuración (/settings)

---

### [TC-150] Editar configuración de organización (admin)

**Tipo:** P  
**Prioridad:** Media

**Pasos:**
1. Ir a `/settings` → pestaña "Organización"
2. Hacer clic en "Editar"
3. Cambiar la zona horaria a `America/Monterrey`
4. Guardar

**Resultado esperado:**
- PATCH a `/api/v1/settings`
- HTTP 200 con `{ ok: true }`
- La nueva zona horaria se muestra en la UI
- Cambio persistido en la DB

---

### [TC-151] Editar configuración como operador (sin permisos)

**Tipo:** N  
**Prioridad:** Alta

**Precondiciones:** Usuario con `role = "operator"` autenticado

**Pasos:**
1. Ir a `/settings` → pestaña "Organización"

**Resultado esperado:**
- El botón "Editar" NO es visible para roles distintos de admin
- El bloque informativo de "Solo administradores pueden modificar..." es visible

---

### [TC-152] Cambiar umbral de auto-proceso

**Tipo:** P  
**Prioridad:** Alta

**Pasos:**
1. En `/settings` → pestaña "Organización", como admin
2. Mover el slider a 75%
3. Hacer clic en "Guardar umbral"

**Resultado esperado:**
- PATCH a `/api/v1/settings` con `{ autoProcessThreshold: 0.75 }`
- `organizations.auto_process_threshold = 0.75` en DB
- El pipeline usará este valor para determinar auto-proceso

---

### [TC-153] Invitar usuario nuevo al equipo

**Tipo:** P  
**Prioridad:** Alta

**Pasos:**
1. Ir a `/settings` → pestaña "Equipo" → "Nuevo usuario"
2. Ingresar email `nuevo@acme.mx`, nombre "Nuevo Usuario", rol "Operador"
3. Guardar

**Resultado esperado:**
- POST a `/api/v1/team`
- Se muestra la contraseña temporal para compartir
- El usuario aparece en la tabla del equipo
- El usuario puede iniciar sesión con la contraseña temporal
- La contraseña temporal solo se muestra una vez (no almacenada en texto plano en la DB)

---

### [TC-154] Invitar usuario con email duplicado

**Tipo:** N  
**Prioridad:** Alta

**Pasos:**
1. Intentar invitar a `carlos@acme.mx` (ya existe)

**Resultado esperado:**
- Error de duplicado (violación de unique constraint en `org_users.email`)
- Mensaje de error en la UI

---

### [TC-155] Crear webhook con feature habilitada

**Tipo:** P  
**Prioridad:** Alta

**Precondiciones:** Feature `webhook_system` habilitada

**Pasos:**
1. Ir a `/settings` → pestaña "Webhooks"
2. Crear un nuevo webhook con URL `https://httpbin.org/post` y eventos `completed`, `failed`

**Resultado esperado:**
- POST a `/api/v1/webhooks`
- HTTP 201 con el webhook creado y su `secret` mostrado una vez
- El secret aparece en un banner de advertencia "Guarda este secret ahora"
- El webhook aparece en la lista

---

### [TC-156] Webhook no visible si feature deshabilitada

**Tipo:** N  
**Prioridad:** Alta

**Precondiciones:** Feature `webhook_system` deshabilitada

**Pasos:**
1. Ir a `/settings`

**Resultado esperado:**
- La pestaña "Webhooks" NO aparece en el selector de pestañas

---

### [TC-157] Crear API Key con feature habilitada

**Tipo:** P  
**Prioridad:** Alta

**Precondiciones:** Feature `api_keys` habilitada

**Pasos:**
1. Ir a `/settings` → pestaña "API Keys"
2. Hacer clic en "Nueva API Key"
3. Ingresar nombre "Mi Sistema ERP"
4. Generar

**Resultado esperado:**
- POST a `/api/v1/settings/api-keys`
- HTTP 201 con `{ id, name, keyPrefix, createdAt, isActive: true, rawKey: "dk_..." }`
- El `rawKey` completo se muestra solo una vez en el banner de advertencia
- El `keyHash` (SHA-256 del rawKey) se almacena en DB, NO el rawKey
- Al navegar a otra pestaña y volver, el rawKey ya no es visible

---

### [TC-158] rawKey no se muestra al volver a la pestaña API Keys

**Tipo:** B  
**Prioridad:** Alta

**Pasos:**
1. Crear una API Key y copiar el rawKey
2. Navegar a la pestaña "Organización"
3. Volver a la pestaña "API Keys"

**Resultado esperado:**
- El banner con el rawKey ya no aparece
- Solo se muestra el prefijo `dk_xxxx` (primeros 12 caracteres)

---

### [TC-159] Revocar API Key

**Tipo:** P  
**Prioridad:** Alta

**Pasos:**
1. En `/settings` → "API Keys", hacer clic en el ícono de eliminar de una key activa
2. Confirmar la revocación

**Resultado esperado:**
- DELETE a `/api/v1/settings/api-keys/<id>`
- La key desaparece de la lista (soft delete: `revoked_at` poblado)

---

### [TC-160] Crear API Key sin rol admin

**Tipo:** N  
**Prioridad:** Alta

**Precondiciones:** Usuario con `role = "operator"`

**Pasos:**
1. Enviar POST a `/api/v1/settings/api-keys` con nombre

**Resultado esperado:**
- HTTP 401 con `{ error: "Unauthorized" }`
- Solo role `admin` puede crear API Keys

---

### [TC-161] Audit log visible para admins con feature habilitada

**Tipo:** P  
**Prioridad:** Alta

**Precondiciones:** Feature `tenant_audit_log` habilitada; usuario con `role = "admin"`

**Pasos:**
1. Ir a `/settings` → pestaña "Auditoría"

**Resultado esperado:**
- Tabla con entradas de auditoría (login, document uploaded, etc.)
- Columnas: Fecha, Usuario, Acción, Recurso, IP
- Botón de "Cargar más" si hay más de 25 entradas

---

### [TC-162] Audit log oculto si feature deshabilitada

**Tipo:** N  
**Prioridad:** Alta

**Precondiciones:** Feature `tenant_audit_log` deshabilitada

**Pasos:**
1. Ir a `/settings`

**Resultado esperado:**
- La pestaña "Auditoría" NO aparece en el selector de pestañas

---

### [TC-163] API Keys no visible si feature deshabilitada

**Tipo:** N  
**Prioridad:** Alta

**Precondiciones:** Feature `api_keys` deshabilitada

**Pasos:**
1. Ir a `/settings`

**Resultado esperado:**
- La pestaña "API Keys" NO aparece
- GET a `/api/v1/settings/api-keys` retorna HTTP 403 con `{ error: "Feature not enabled" }`

---

---

# MÓDULO 15 — Feature Flags — Gates de UI (Sidebar)

---

### [TC-170] Sidebar con todas las features habilitadas

**Tipo:** P  
**Prioridad:** Media

**Precondiciones:** `exception_queue`, `auto_mapping`, `advanced_analytics`, `bulk_upload` todas habilitadas

**Pasos:**
1. Iniciar sesión como tenant
2. Observar el sidebar

**Resultado esperado:**
- Visibles: Dashboard, Workflow, Historial, Excepciones, Mapeos, Catálogos, Estadísticas, Configuración

---

### [TC-171] exception_queue deshabilitada — sin link en sidebar

**Tipo:** N  
**Prioridad:** Alta

**Precondiciones:** Feature `exception_queue` deshabilitada

**Resultado esperado:**
- El link a `/exceptions` NO aparece en el sidebar

---

### [TC-172] auto_mapping deshabilitada — sin link en sidebar

**Tipo:** N  
**Prioridad:** Alta

**Resultado esperado:**
- El link a `/mappings` NO aparece en el sidebar

---

### [TC-173] advanced_analytics deshabilitada — sin link en sidebar

**Tipo:** N  
**Prioridad:** Alta

**Resultado esperado:**
- El link a `/statistics` NO aparece en el sidebar

---

### [TC-174] bulk_upload deshabilitado — sin toggle en Workflow

**Tipo:** N  
**Prioridad:** Alta

**Precondiciones:** Feature `bulk_upload` deshabilitada

**Pasos:**
1. Ir a `/workflow`

**Resultado esperado:**
- El toggle o botón "Subir varios" NO aparece en la interfaz

---

### [TC-175] bulk_upload deshabilitado — gate de servidor activo

**Tipo:** N  
**Prioridad:** Alta

**Precondiciones:** Feature `bulk_upload` deshabilitada

**Pasos:**
1. Enviar POST a `/api/v1/workflow/upload` con `bulk=true` en el formData

**Resultado esperado:**
- HTTP 403 con `{ error: "La carga masiva no está disponible en tu plan" }`

---

### [TC-176] white_label habilitado — branding personalizado

**Tipo:** P  
**Prioridad:** Alta

**Precondiciones:**
- Feature `white_label` habilitada con config `{ company_name: "MiEmpresa", logo_url: "https://...", hide_branding: true }`

**Pasos:**
1. Iniciar sesión como tenant
2. Observar el sidebar

**Resultado esperado:**
- El nombre en el sidebar muestra "MiEmpresa" en lugar de "DocuIA"
- Si `logo_url` está configurado, se muestra la imagen personalizada
- Si `hide_branding = true`, el texto/logo de "DocuIA" está oculto

---

### [TC-177] white_label — primary_color no aplicado — FASE 2

**Tipo:** B  
**Estado:** `[FASE 2 — NO EJECUTAR]`

**Descripción:**
El campo `primary_color` del config de `white_label` está definido en el esquema pero **no** se aplica a variables CSS. Aunque se configure `{ primary_color: "#FF0000" }`, el color primario del UI no cambia.

---

### [TC-178] ip_allowlist — IP permitida accede normalmente

**Tipo:** P  
**Prioridad:** Alta

**Precondiciones:**
- Feature `ip_allowlist` habilitada con `allowed_ips: ["192.168.1.0/24", "10.0.0.5"]`
- El cliente accede desde una IP en el rango

**Pasos:**
1. Acceder a cualquier ruta de tenant desde la IP permitida

**Resultado esperado:**
- Acceso normal — el contenido se renderiza sin restricción

---

### [TC-179] ip_allowlist — IP no permitida es bloqueada

**Tipo:** N  
**Prioridad:** Alta

**Precondiciones:**
- Feature `ip_allowlist` habilitada con `allowed_ips: ["192.168.1.0/24"]`
- El cliente accede desde una IP fuera del rango (ej: `10.5.5.5`)

**Pasos:**
1. Acceder a `/dashboard` desde una IP no permitida

**Resultado esperado:**
- El layout retorna una página HTML con mensaje "Acceso restringido"
- No se muestra el contenido del portal

---

### [TC-180] ip_allowlist — localhost siempre permitido

**Tipo:** B  
**Prioridad:** Alta

**Precondiciones:**
- Feature `ip_allowlist` habilitada con `allowed_ips: ["192.168.1.0/24"]`
- Accediendo desde `127.0.0.1` o `::1`

**Pasos:**
1. Acceder desde localhost al portal

**Resultado esperado:**
- El acceso **no** es bloqueado
- El código verifica explícitamente `isLocal` antes de aplicar el allowlist

---

### [TC-181] ip_allowlist — CIDR /32 (IP exacta como CIDR)

**Tipo:** B  
**Prioridad:** Baja

**Precondiciones:**
- `allowed_ips: ["203.0.113.45/32"]`

**Pasos:**
1. Acceder desde `203.0.113.45`
2. Acceder desde `203.0.113.46`

**Resultado esperado:**
- `203.0.113.45` — acceso permitido
- `203.0.113.46` — acceso bloqueado

---

---

# MÓDULO 16 — NetSuite — Conexión OAuth

---

### [TC-190] Firma OAuth 1.0a HMAC-SHA256 correcta

**Tipo:** P  
**Prioridad:** Alta

**Precondiciones:** Credenciales NS válidas disponibles

**Pasos:**
1. Realizar cualquier llamada autenticada a la REST API de NS (ej: test connection)
2. Verificar en los logs que la cabecera `Authorization: OAuth ...` es correcta

**Resultado esperado:**
- NS acepta la firma (HTTP 200 o 403 por permisos de registro, no por firma inválida)
- El nonce es único por request
- El timestamp es el actual en UNIX seconds

---

### [TC-191] Firma con consumer_secret incorrecto

**Tipo:** N  
**Prioridad:** Alta

**Pasos:**
1. Usar credenciales con `consumer_secret` incorrecto
2. Llamar a la API de NS

**Resultado esperado:**
- NS retorna HTTP 401 con "Invalid login credentials" o "The credentials you provided are invalid"
- `{ ok: false, error: "HTTP 401: ..." }`

---

### [TC-192] Llamada a NS sin conexión configurada

**Tipo:** N  
**Prioridad:** Alta

**Precondiciones:** Org sin `ns_connections` para el ambiente activo

**Pasos:**
1. Intentar procesar un documento que llegaría a NS

**Resultado esperado:**
- Error: `"No NS connection for org <orgId> (<env>)"`
- El documento queda en `status = "failed"`
- Se crea excepción con `failure_stage = "process"`

---

### [TC-193] NS con scripts no configurados

**Tipo:** N  
**Prioridad:** Alta

**Precondiciones:** `ns_connections` existe pero `process_script_id` o `process_deploy_id` son NULL

**Pasos:**
1. Intentar procesar un documento

**Resultado esperado:**
- Error: `"Process script not configured for this organization"`
- Documento en `status = "failed"`, excepción creada

---

### [TC-194] Timeout de red al conectar con NS

**Tipo:** N  
**Prioridad:** Media

**Precondiciones:** NetSuite inaccesible (ej: bloquear la URL en el firewall local o usar un Account ID de sandbox inactivo)

**Pasos:**
1. Intentar procesar un documento cuando NS no responde

**Resultado esperado:**
- La llamada a `fetch()` arroja error de red (ECONNREFUSED, ETIMEDOUT)
- `processDocument()` captura el error y retorna `{ ok: false, error: "..." }`
- Documento en `status = "failed"`, excepción creada

---

### [TC-195] Cifrado y descifrado de credenciales

**Tipo:** P  
**Prioridad:** Alta

**Pasos:**
1. Guardar credenciales NS via el wizard
2. En DB: verificar que los campos `consumer_key`, `consumer_secret`, `token_id`, `token_secret` están cifrados
3. Procesar un documento (que internamente descifra las credenciales)

**Resultado esperado:**
- Los campos en DB son strings cifrados (no texto plano)
- `decryptField()` recupera el valor original correctamente
- El procesamiento funciona (la firma OAuth se construye con los valores descifrados)

---

### [TC-196] Ambiente sandbox vs producción

**Tipo:** P  
**Prioridad:** Alta

**Pasos:**
1. Configurar `active_ns_environment = "sandbox"` para la org
2. Confirmar que las llamadas van a `<TSTDRV...>.suitetalk.api.netsuite.com`

**Resultado esperado:**
- Las URLs construidas por `buildRestApiUrl()` y `buildRestletUrl()` usan el Account ID de sandbox
- No hay cross-contamination entre ambientes

---

---

# MÓDULO 17 — NetSuite — Fallas Específicas

Esta sección cubre modos de falla específicos de NetSuite. Todos estos son **casos negativos** que el sistema debe manejar con gracia: el documento queda en `failed`, se crea una excepción, y se registra el error.

---

### [TC-200] Vendor ID inválido o inexistente

**Tipo:** N  
**Prioridad:** Alta  
**Record Type:** Vendor Bill / Purchase Order

**Input:**
- `vendor_internal_id`: ID de un proveedor que no existe en NS (ej: `9999999`)
- Resto de campos válidos

**Resultado esperado:**
- NS RESTlet retorna error `INVALID_KEY_OR_REF` o similar
- `processDocument()` retorna `{ ok: false, error: "..." }`
- Documento en `status = "failed"`, `failure_stage = "process"`
- Mensaje de error incluye referencia al vendor ID inválido

---

### [TC-201] Vendor inactivo en NetSuite

**Tipo:** N  
**Prioridad:** Alta

**Input:**
- `vendor_internal_id`: ID de un proveedor con `inactive = true` en NS

**Resultado esperado:**
- NS rechaza la transacción
- Error capturado, documento en `status = "failed"`
- El catálogo de proveedores debería excluir vendors inactivos (verificar que `is_inactive = false` filtra en los mapeos)

---

### [TC-202] Vendor de subsidiaria incorrecta (mismatch)

**Tipo:** N  
**Prioridad:** Alta

**Input:**
- `vendor_internal_id`: ID de un proveedor que solo tiene acceso a Subsidiary A
- `subsidiary_internal_id`: ID de Subsidiary B

**Resultado esperado:**
- NS retorna error de tipo "You cannot use the specified entity with the subsidiary selected"
- Error capturado, documento en `status = "failed"`

**Nota NetSuite:** En cuentas OneWorld, los vendors tienen restricciones de subsidiaria. Este es un error común de integración.

---

### [TC-203] Item inválido o inexistente en línea

**Tipo:** N  
**Prioridad:** Alta  
**Record Type:** Vendor Bill

**Input:**
- `line_items[0].item_internal_id`: ID de un ítem que no existe en NS (ej: `8888888`)

**Resultado esperado:**
- NS RESTlet retorna `INVALID_KEY_OR_REF` para la línea del ítem
- Error capturado en el pipeline

---

### [TC-204] Item inactivo en línea

**Tipo:** N  
**Prioridad:** Alta

**Input:**
- `line_items[0].item_internal_id`: ID de un ítem con `inactive = true` en NS

**Resultado esperado:**
- NS rechaza la transacción por ítem inactivo
- El catálogo de ítems debería filtrar ítems inactivos para evitar selección errónea

---

### [TC-205] Item de tipo incorrecto para el tipo de transacción

**Tipo:** N  
**Prioridad:** Alta

**Input:**
- Tipo de documento: `purchase_order`
- `line_items[0].item_internal_id`: ID de un Service Item que no aplica a órdenes de compra en esa configuración de NS

**Resultado esperado:**
- NS retorna error de tipo de ítem incompatible
- Error capturado, documento en `status = "failed"`

---

### [TC-206] Subsidiary ID inválido o inexistente

**Tipo:** N  
**Prioridad:** Alta

**Input:**
- `subsidiary_internal_id`: ID de una subsidiaria que no existe en el account NS (ej: `9999`)

**Resultado esperado:**
- NS retorna `INVALID_KEY_OR_REF` para la subsidiaria
- Error capturado

---

### [TC-207] Subsidiary inactiva

**Tipo:** N  
**Prioridad:** Alta

**Input:**
- `subsidiary_internal_id`: ID de una subsidiaria desactivada en NS

**Resultado esperado:**
- NS rechaza la creación del registro
- Error capturado, documento en `status = "failed"`

---

### [TC-208] Número de documento duplicado en NS

**Tipo:** N  
**Prioridad:** Alta

**Input:**
- `invoice_number`: número de factura que ya existe en NS para el mismo vendor

**Resultado esperado:**
- NS retorna error `DUP_RCRD` o "A bill with this document number already exists for this vendor"
- Error capturado
- Nota: este error es distinto al de `duplicate_detection` interno; el duplicado en NS puede existir incluso si DocuIA no lo detectó localmente

---

### [TC-209] externalId duplicado (si se implementa)

**Tipo:** N  
**Prioridad:** Alta

**Descripción:**
Si el RESTlet usa `externalId` para crear registros en NS, un segundo intento con el mismo externalId retornará un error `DUP_RCRD`.

**Resultado esperado:**
- NS retorna `DUP_RCRD`
- El pipeline captura el error correctamente
- Documentar el comportamiento actual del RESTlet: ¿usa externalId? ¿hace upsert?

---

### [TC-210] Fecha en formato incorrecto

**Tipo:** N  
**Prioridad:** Media

**Input:**
- `invoice_date`: `"2024-01-15"` (ISO format que el parser convierte a `"15/01/2024"`)

**Resultado esperado:**
- El parser en `parseDateForNS()` convierte ISO `YYYY-MM-DD` a `DD/MM/YYYY`
- NS acepta el formato `DD/MM/YYYY`
- Verificar que fechas en formato `.` (alemán) como `"15.01.2024"` también se convierten a `"15/01/2024"`

---

### [TC-211] Moneda inválida o no habilitada en subsidiaria

**Tipo:** N  
**Prioridad:** Media

**Input:**
- `currency_internal_id`: ID de una moneda no habilitada en la subsidiaria

**Resultado esperado:**
- NS retorna error de moneda inválida
- Error capturado

---

### [TC-212] Sin líneas válidas en el payload

**Tipo:** N  
**Prioridad:** Alta

**Input:**
- `line_items`: array vacío `[]` o todas las líneas con `item_internal_id = ""`

**Resultado esperado:**
- El proceso de aprobación en `/api/v1/workflow/<docId>/approve` retorna HTTP 422 con `{ error: "Sin líneas válidas para enviar" }`
- Si el filtro de líneas en `buildRestletBody()` elimina todas las líneas, el RESTlet recibiría un payload con `lines: []` — verificar que NS retorna error o que el cliente lo previene antes

---

### [TC-213] Periodo contable cerrado

**Tipo:** N  
**Prioridad:** Media

**Input:**
- `invoice_date`: fecha en un periodo contable que está cerrado en NS

**Resultado esperado:**
- NS retorna error de periodo cerrado ("The accounting period you specified is closed")
- Error capturado, documento en `status = "failed"`
- Nota: este error no puede ser detectado localmente; solo NS puede saberlo

---

### [TC-214] Ubicación de subsidiaria incorrecta

**Tipo:** N  
**Prioridad:** Alta

**Input:**
- `location_internal_id`: ID de una ubicación que pertenece a una subsidiaria diferente a la del documento

**Resultado esperado:**
- NS retorna error de mismatch de subsidiaria/ubicación
- Error capturado

---

### [TC-215] Respuesta del RESTlet con ok:false pero HTTP 200

**Tipo:** N  
**Prioridad:** Alta

**Descripción:**
El RESTlet puede retornar HTTP 200 pero con `{ ok: false, error: "mensaje de error interno" }` para errores de negocio.

**Resultado esperado:**
- El cliente NS en `processDocument()` evalúa `json.ok ?? true`; si es `false`, retorna `{ ok: false }`
- El pipeline captura el error y el documento queda en `failed`

---

---

# MÓDULO 18 — NetSuite — Modo Dry Run

---

### [TC-220] Dry run activo — no se crean registros en NS

**Tipo:** P  
**Prioridad:** Alta

**Precondiciones:** Feature `netsuite_dry_run` habilitada

**Pasos:**
1. Subir un documento que llega al paso de NS
2. Observar el payload enviado al RESTlet

**Resultado esperado:**
- El campo `dry_run: true` se incluye en el body del RESTlet
- NS procesa la validación pero **no** crea el registro (el RESTlet debe respetar este flag)
- `history_documents.status = "completed"` (DocuIA lo marca completo si NS confirma dry run exitoso)
- `netsuite_doc_id` puede ser null o un ID ficticio retornado por NS en modo dry run

---

### [TC-221] Dry run inactivo — registros se crean realmente

**Tipo:** P  
**Prioridad:** Alta

**Precondiciones:** Feature `netsuite_dry_run` deshabilitada; NS de sandbox disponible

**Pasos:**
1. Subir un documento válido
2. Confirmar que el pipeline envía `dry_run: false`

**Resultado esperado:**
- El campo `dry_run: false` en el body del RESTlet
- NS crea el registro real; retorna `internalId` real
- `netsuite_doc_id` contiene el ID real del registro creado en NS
- `url_netsuite` contiene la URL correcta al registro en NS

---

### [TC-222] Dry run en aprobación manual

**Tipo:** P  
**Prioridad:** Alta

**Precondiciones:** `netsuite_dry_run` habilitada; documento en `pending_approval`

**Pasos:**
1. Un admin aprueba el documento via POST a `/api/v1/workflow/<docId>/approve`

**Resultado esperado:**
- El endpoint consulta `isFeatureEnabled(orgId, "netsuite_dry_run")` antes de llamar a NS
- El payload incluye `dry_run: true`

---

### [TC-223] Cambiar dry_run de true a false en producción

**Tipo:** B  
**Prioridad:** Alta

**Precondiciones:** Se ha estado usando dry_run en pruebas; se desea activar producción

**Pasos:**
1. Como admin de plataforma, deshabilitar `netsuite_dry_run` para la org
2. Procesar un nuevo documento

**Resultado esperado:**
- El cambio toma efecto en el siguiente documento (la feature se evalúa por cada pipeline run)
- Los documentos anteriores procesados con dry_run no se reenvían automáticamente

---

---

# MÓDULO 19 — Cron Jobs

---

### [TC-230] Cron sin header de autenticación

**Tipo:** N  
**Prioridad:** Alta

**Pasos:**
1. Enviar GET a `/api/internal/cron/retention` sin header `X-Cron-Secret`

**Resultado esperado:**
- HTTP 401 con `{ error: "Unauthorized" }`

---

### [TC-231] Cron con secret incorrecto

**Tipo:** N  
**Prioridad:** Alta

**Pasos:**
1. Enviar GET a `/api/internal/cron/retention` con `X-Cron-Secret: secretinvalido`

**Resultado esperado:**
- HTTP 401 con `{ error: "Unauthorized" }`

---

### [TC-232] Cron de retención — elimina documentos completados

**Tipo:** P  
**Prioridad:** Alta

**Precondiciones:**
- Feature `data_retention` habilitada con `{ history_retention_days: 1, logs_retention_days: 1 }`
- Existen documentos completados con `created_at` de más de 1 día

**Pasos:**
1. Enviar GET a `/api/internal/cron/retention` con header `X-Cron-Secret: <CRON_SECRET>`

**Resultado esperado:**
- HTTP 200 con `{ ok: true, summary: { "<orgId>": { history: N, logs: M } } }`
- Los documentos completados más viejos que la fecha de corte son eliminados de `history_documents`
- Los logs de workflow más viejos son eliminados de `workflow_runtime_logs`

---

### [TC-233] Cron de retención — feature deshabilitada

**Tipo:** P  
**Prioridad:** Media

**Precondiciones:** Feature `data_retention` deshabilitada para la org

**Pasos:**
1. Ejecutar el cron de retención

**Resultado esperado:**
- La org es ignorada (`feat.isEnabled = false` → `continue`)
- No se elimina ningún documento de esa org
- `summary` no incluye la org o la marca como skipped

---

### [TC-234] Cron de retención — no elimina documentos en estado "failed"

**Tipo:** B  
**Prioridad:** Media

**Precondiciones:** Existe un documento con `status = "failed"` más viejo que el periodo de retención

**Resultado esperado:**
- El DELETE solo aplica a documentos con `status = "completed"` (verificar el WHERE en el código)
- Los documentos fallidos NO son eliminados por el cron

---

### [TC-235] Cron de auto-sync ejecuta sincronización

**Tipo:** P  
**Prioridad:** Alta

**Precondiciones:**
- Feature `auto_sync` habilitada con `{ interval_hours: 1 }`
- Última sincronización hace más de 1 hora (o sin sincronización previa)
- NS configurado con catálogo disponible

**Pasos:**
1. Ejecutar GET a `/api/internal/cron/auto-sync` con header correcto

**Resultado esperado:**
- Se upsert ítems, vendors y locations en las tablas de catálogo
- `summary[orgId][subId]` muestra counts de registros procesados

---

### [TC-236] Cron de auto-sync — no sincroniza si no es momento

**Tipo:** P  
**Prioridad:** Media

**Precondiciones:**
- Última sincronización hace menos de `interval_hours`

**Resultado esperado:**
- `summary[orgId][subId] = { skipped: "not due yet" }`
- No se realizan llamadas al RESTlet de NS

---

### [TC-237] Cron de auto-sync — sin script de catálogo configurado

**Tipo:** N  
**Prioridad:** Media

**Precondiciones:** `ns_connections` existe pero `catalog_script_id` o `catalog_deploy_id` son NULL

**Resultado esperado:**
- `summary[orgId] = { skipped: "no catalog script configured" }`
- No se genera error 500

---

### [TC-238] Cron de reportes programados ejecuta

**Tipo:** P  
**Prioridad:** Media

**Precondiciones:**
- Feature `scheduled_reports` habilitada con recipients configurados
- `RESEND_API_KEY` configurado o modo fallback a consola

**Pasos:**
1. Ejecutar GET a `/api/internal/cron/scheduled-reports` con header correcto

**Resultado esperado:**
- Se envían emails a los destinatarios configurados con las estadísticas del período
- HTTP 200 con resumen de envíos

---

---

# MÓDULO 20 — Webhooks

---

### [TC-240] Webhook disparado al completar documento

**Tipo:** P  
**Prioridad:** Alta

**Precondiciones:**
- Webhook activo configurado para evento `document.completed`
- URL del webhook que capture la request (ej: httpbin.org/post o requestbin)

**Pasos:**
1. Procesar un documento hasta `status = "completed"`

**Resultado esperado:**
- El webhook recibe un POST con el payload correcto
- Header `X-DocuIA-Signature: sha256=<firma-hmac>` presente
- Body: `{ event: "document.completed", data: { document: { id, status, documentType, vendor, total, netsuiteDocId, recordUrl } } }`
- `webhooks.last_triggered_at` y `last_status_code` actualizados en DB

---

### [TC-241] Webhook disparado al ir a revisión

**Tipo:** P  
**Prioridad:** Alta

**Precondiciones:** Webhook activo para evento `document.review`

**Pasos:**
1. Subir documento con confianza baja (→ `status = "review"`)

**Resultado esperado:**
- Webhook recibe POST con `event: "document.review"`

---

### [TC-242] Webhook disparado al fallar

**Tipo:** P  
**Prioridad:** Alta

**Precondiciones:** Webhook activo para evento `document.failed`

**Pasos:**
1. Provocar un fallo (ej: subir XML mal formado o provocar error de NS)

**Resultado esperado:**
- Webhook recibe POST con `event: "document.failed"` y el mensaje de error

---

### [TC-243] Verificar firma HMAC del webhook

**Tipo:** P  
**Prioridad:** Alta

**Pasos:**
1. Capturar un webhook request
2. Calcular `HMAC-SHA256(body, webhookSecret)`
3. Comparar con el valor en `X-DocuIA-Signature`

**Resultado esperado:**
- La firma coincide exactamente
- El secret original (mostrado al crear el webhook) es el que se usa para firmar

---

### [TC-244] Webhook a URL que falla (4xx/5xx)

**Tipo:** N  
**Prioridad:** Media

**Precondiciones:** Webhook configurado con URL que retorna 500

**Pasos:**
1. Completar un documento que disparará el webhook

**Resultado esperado:**
- El error del webhook NO bloquea el procesamiento del documento (entrega es `fire-and-forget`)
- `last_status_code` se actualiza con el código de error (5xx)
- El documento queda en `status = "completed"` de todas formas

---

### [TC-245] Webhook inactivo no se dispara

**Tipo:** N  
**Prioridad:** Media

**Precondiciones:** Webhook con `is_active = false`

**Pasos:**
1. Procesar un documento

**Resultado esperado:**
- El webhook inactivo no recibe ningún POST
- Los webhooks activos sí se disparan normalmente

---

### [TC-246] Eliminar webhook

**Tipo:** P  
**Prioridad:** Media

**Pasos:**
1. Ir a `/settings` → Webhooks
2. Hacer clic en eliminar un webhook

**Resultado esperado:**
- DELETE a `/api/v1/webhooks/<id>`
- El webhook desaparece de la lista
- Futuros documentos no disparan este webhook

---

### [TC-247] Crear webhook sin eventos seleccionados

**Tipo:** N  
**Prioridad:** Media

**Pasos:**
1. Intentar crear un webhook sin seleccionar ningún evento

**Resultado esperado:**
- El botón "Crear webhook" permanece deshabilitado cuando `hookEvents.length === 0`
- No se puede enviar el formulario

---

---

# MÓDULO 21 — API Keys

---

### [TC-250] Crear API Key retorna rawKey solo una vez

**Tipo:** P  
**Prioridad:** Alta

**Pasos:**
1. POST a `/api/v1/settings/api-keys` con `{ name: "Test Key" }`

**Resultado esperado:**
- Respuesta incluye `rawKey: "dk_<64 chars hex>"`
- El `rawKey` comienza con `dk_`
- `keyHash` (SHA-256 del rawKey) almacenado en DB, NO el rawKey
- `keyPrefix = rawKey.substring(0, 12)` visible en listados

---

### [TC-251] Listar API Keys no expone rawKey

**Tipo:** P  
**Prioridad:** Alta

**Pasos:**
1. GET a `/api/v1/settings/api-keys`

**Resultado esperado:**
- La respuesta incluye `id`, `name`, `keyPrefix`, `isActive`, `lastUsedAt`, `expiresAt`, `createdAt`
- No incluye `keyHash` ni `rawKey`

---

### [TC-252] Revocar API Key (soft delete)

**Tipo:** P  
**Prioridad:** Alta

**Pasos:**
1. DELETE a `/api/v1/settings/api-keys/<id>`

**Resultado esperado:**
- HTTP 200
- `api_keys.revoked_at` poblado en DB
- La key aparece como "Revocada" en el listado (o desaparece, según la implementación)

---

### [TC-253] Crear API Key con nombre vacío

**Tipo:** N  
**Prioridad:** Media

**Pasos:**
1. POST a `/api/v1/settings/api-keys` con `{ name: "" }`

**Resultado esperado:**
- HTTP 400 con `{ error: "Name required" }`

---

### [TC-254] Usar API Key como Bearer — FASE 2

**Tipo:** N  
**Prioridad:** Alta  
**Estado:** `[FASE 2 — NO EJECUTAR]`

**Descripción:**
Las API Keys pueden crearse y revocarse, pero el middleware que valida `Authorization: Bearer dk_...` para autenticar requests a la API **no está implementado** en Fase 1.

**Resultado esperado cuando se implemente:**
- Request con `Authorization: Bearer dk_<válido>` es autenticado
- Request con key revocada retorna HTTP 401
- Request con key expirada retorna HTTP 401

---

### [TC-255] GET API Keys con feature deshabilitada

**Tipo:** N  
**Prioridad:** Alta

**Precondiciones:** Feature `api_keys` deshabilitada

**Pasos:**
1. GET a `/api/v1/settings/api-keys`

**Resultado esperado:**
- HTTP 403 con `{ error: "Feature not enabled" }`

---

### [TC-256] POST API Key con feature deshabilitada

**Tipo:** N  
**Prioridad:** Alta

**Precondiciones:** Feature `api_keys` deshabilitada

**Pasos:**
1. POST a `/api/v1/settings/api-keys` con `{ name: "Test" }`

**Resultado esperado:**
- HTTP 403 con `{ error: "Feature not enabled" }`

---

### [TC-257] POST API Key como operador (sin rol admin)

**Tipo:** N  
**Prioridad:** Alta

**Precondiciones:** Feature `api_keys` habilitada; usuario con `role = "operator"`

**Pasos:**
1. POST a `/api/v1/settings/api-keys`

**Resultado esperado:**
- HTTP 401 con `{ error: "Unauthorized" }`
- Solo admins pueden crear API Keys

---

---

# FASE 2 — Funcionalidades Diferidas (Referencia)

Las siguientes funcionalidades están documentadas para referencia pero **no deben probarse** porque no están implementadas en Fase 1.

| ID | Funcionalidad | Estado |
|---|---|---|
| F2-001 | Gates de API en general (403 al llamar endpoints con feature deshabilitada) | No implementado — solo UI gates |
| F2-002 | Stripe billing — lógica de facturación, planes, upgrades | Env vars definidos, sin lógica |
| F2-003 | white_label primary_color — aplicar a variables CSS | Config almacenado, no aplicado |
| F2-004 | SSO SAML — autenticación empresarial | Schema definido, sin handler |
| F2-005 | Middleware Bearer para API Keys (dk_...) | Keys CRUD implementado, middleware no |
| F2-006 | UI de configuración para scheduled_reports | Cron funciona, sin UI de config |
| F2-007 | Gate de servidor para /api/v1/stats con advanced_analytics | Endpoint sin verificación de feature |

---

---

# Apéndice A — Configuración de Features para Pruebas

Para ejecutar las pruebas de esta matriz, se recomienda la siguiente configuración de features para el tenant demo (Distribuidora Acme):

| Feature | Estado recomendado para pruebas | Notas |
|---|---|---|
| `document_storage` | Habilitado | Requiere MinIO activo |
| `netsuite_dry_run` | Habilitado | Evita crear registros reales en NS |
| `ai_tiered_fallback` | Habilitado | Permite fallback automático |
| `ai_force_secondary` | Deshabilitado | Habilitar solo para TC-104 |
| `duplicate_detection` | Habilitado | Para pruebas de duplicados |
| `approval_workflow` | Deshabilitado (por defecto) | Habilitar solo para TC-093 y TC-094 |
| `data_export` | Habilitado | Para prueba TC-112 |
| `bulk_upload` | Deshabilitado | Para prueba TC-101 y TC-174/175 |
| `exception_queue` | Habilitado | Para pruebas de excepciones |
| `auto_mapping` | Habilitado | Para visibilidad en sidebar |
| `advanced_analytics` | Habilitado | Para visibilidad en sidebar |
| `webhook_system` | Habilitado | Para pruebas de webhooks |
| `api_keys` | Habilitado | Para pruebas de API Keys |
| `tenant_audit_log` | Habilitado | Para visibilidad en settings |
| `data_retention` | Habilitado con config `{ history_retention_days: 1, logs_retention_days: 1 }` | Para prueba TC-232 |
| `auto_sync` | Habilitado | Para prueba TC-235 |
| `scheduled_reports` | Habilitado | Para prueba TC-238 |
| `ip_allowlist` | Deshabilitado (por defecto) | Habilitar solo para TC-178/179/180/181 |
| `white_label` | Deshabilitado (por defecto) | Habilitar solo para TC-176 |

---

# Apéndice B — Endpoints API con Gate de Servidor Confirmado (Fase 1)

Solo estos dos endpoints verifican el feature flag del lado del servidor y retornan 403:

| Endpoint | Feature | Código de error |
|---|---|---|
| GET `/api/v1/history/export` | `data_export` | `{ error: "Feature no disponible" }` |
| POST `/api/v1/workflow/upload` (cuando `bulk=true`) | `bulk_upload` | `{ error: "La carga masiva no está disponible en tu plan" }` |

Todos los demás gates son **solo de UI** — los endpoints son accesibles directamente aunque la feature esté deshabilitada.

---

# Apéndice C — Tablas de Base de Datos Relevantes

Para verificar resultados esperados en pruebas de integración:

| Tabla | Propósito |
|---|---|
| `organizations` | Orgs tenant con `auto_process_threshold`, `active_ns_environment` |
| `org_users` | Usuarios tenant con `role`, `is_active`, `reset_token` |
| `auth_sessions` | Sesiones activas con `revoked_at`, `refresh_token` (nonce) |
| `platform_admins` | Admins de plataforma |
| `features` | Catálogo de 25 features con defaults |
| `org_features` | Overrides por org (upsert) |
| `history_documents` | Documentos procesados con `status`, `storage_key`, `products`, `netsuite_doc_id` |
| `exception_queue` | Documentos fallidos con `failure_stage`, `retry_count` |
| `ns_connections` | Credenciales NS cifradas por org y ambiente |
| `subsidiaries` | Subsidiarias con `ns_subsidiary_id` |
| `catalog_items` | Ítems sincronizados desde NS |
| `catalog_vendors` | Vendors sincronizados desde NS |
| `catalog_locations` | Ubicaciones sincronizadas desde NS |
| `webhooks` | Configuración de webhooks con `last_status_code` |
| `api_keys` | Keys con `key_hash`, `key_prefix`, `revoked_at` |
| `audit_log` | Log de acciones de usuarios tenant |
| `admin_audit_log` | Log de acciones de admins de plataforma |
| `workflow_runtime_logs` | Logs de ejecución del pipeline (limpiados por cron) |
