# Revisión de seguridad de DocuIA — 12 de septiembre de 2026

**Estado:** correcciones implementadas y verificadas en el repositorio local. No desplegadas. La configuración interna del servidor público no fue inspeccionada. Este informe no acredita que producción tenga ya estas protecciones ni garantiza ausencia de otras vulnerabilidades.

## Alcance y evidencia

- Revisión del código de autenticación, autorización, aislamiento por organización, rutas API, cargas, generación documental, webhooks, almacenamiento y configuración de despliegue.
- Comprobación externa anónima de `https://n8n-docuia.kzkimf.easypanel.host/`: 13 solicitudes GET de bajo impacto y comprobación HEAD de redirección HTTP/HTTPS. No se guardaron cuerpos de documentos ni se realizaron intentos de contraseñas, explotación destructiva o pruebas de carga contra producción.
- Pruebas de solicitudes adversarias contra una compilación de producción local, con PostgreSQL desechable y credenciales ficticias; sin llamadas reales a correo, IA o NetSuite. Almacenamiento probado con un MinIO independiente y desechable.
- `npm audit` evalúa avisos conocidos de paquetes, no demuestra que una ruta concreta sea explotable. La versión instalada localmente no identifica por sí sola la versión desplegada.

## Hallazgos y correcciones locales

Las prioridades indican el impacto potencial en este proyecto; no son puntuaciones CVSS calculadas ni explotación demostrada del servidor público.

| Prioridad | Problema identificado | Corrección y evidencia |
|---|---|---|
| Alta | Validar únicamente la firma del acceso permite conservar permisos obsoletos y sesiones revocadas. | `lib/auth/jwt.ts` comprueba sesión vigente, usuario activo, organización, rol actual y restricciones IP. Pruebas HTTP verifican revocación, suspensión y cambio de rol inmediato. |
| Alta | Tokens de acceso y renovación sin separación estricta de propósito; carreras al renovar o restablecer contraseña. | Esquemas explícitos `tokenUse`, asociación de sesión y consumo atómico del nonce y del token de recuperación. Dos solicitudes simultáneas producen un único éxito. Los cambios/restablecimientos de contraseña revocan sesiones. |
| Alta | Controles de permisos insuficientes por área y claves API sin alcance efectivo. | `lib/auth/permissions.ts` y guardas en rutas y páginas. Las API keys requieren `documents:read` o `documents:write`; no heredan administración. Viewer solo lee documentos/contratos; expense_submitter accede a gastos y perfil; operator a documentos/contratos y perfil; settings requiere admin. |
| Alta | Referencias a objetos almacenados o catálogos sin acreditar pertenencia. | Plantillas Word limitadas al prefijo de organización y flujo; comprobante HMAC de carga de gastos vinculado a usuario, organización, archivo y metadatos; comprobación de catálogos de la organización. Test HTTP de documento de otro tenant devuelve 404 sin contenido ajeno. |
| Alta | Solicitudes con cookies desde otros orígenes y dependencia excesiva del proxy para proteger rutas. | `withApiSecurity` en los 97 archivos de rutas API; autenticación independiente, permisos por método y comprobación exacta de Origin. Se rechazan dominios hermanos y cookies sin evidencia de mismo origen. Auth/contact y cron conservan sus guardas específicas. |
| Alta | La cabecera IP enviada por el cliente y el trato especial a localhost podían debilitar restricciones. | Eliminado bypass localhost; `TRUSTED_PROXY_HOPS` interpreta la cadena desde el extremo confiable. Sin configuración válida falla de forma restrictiva. Auditoría y API keys usan el mismo cálculo de IP. |
| Alta | Webhooks susceptibles a redirecciones o cambio de DNS entre validación y conexión. | HTTPS público en puerto 443, bloqueo de rangos internos y variantes IPv6; IP validada fijada al socket con verificación TLS del hostname original; sin seguir redirecciones, límite de 10 s tras resolver DNS. Constructor NetSuite restringe el account ID y codifica parámetros. |
| Alta | HTML persistido y pegado en el editor podía transportar contenido activo. | Sanitización de servidor y editor: formato permitido, sin scripts, eventos, SVG, URLs CSS ni recursos remotos. Pegado saneado y arrastre bloqueado. Pruebas conservan formato legítimo y eliminan vectores XSS. |
| Alta | Cargas confiaban en MIME declarado; DOCX podía incluir contenido activo o expansión ZIP excesiva. | Firmas reales de archivo, rechazo de DTD/entidades XML, inspección ZIP antes de PizZip/LibreOffice, límites de bytes realmente expandidos, entradas, partes y tiempo. Rechazo de macros, objetos incrustados, relaciones externas y campos dinámicos. Descargas sensibles incorporan no-store/nosniff/sandbox cuando corresponde. |
| Media/alta | Abuso por cuerpos grandes, cargas lentas, fuerza bruta o llamadas costosas. | Lectura acotada del cuerpo real, timeout de 30 s, límites por cuenta y origen de login, límites compartidos en PostgreSQL para API y operaciones costosas. El limitador falla cerrado cuando no puede persistir. Las descargas almacenadas en memoria tienen un máximo de 60 MiB. Esto no sustituye protección DDoS en el borde. |
| Media | Redirección de login controlable y datos sensibles de correo en logs de desarrollo. | Retorno limitado a rutas internas admitidas. Sin proveedor de correo no se registran contraseñas ni enlaces de recuperación. Las plantillas de entorno y el contexto Docker excluyen secretos reales. |
| Según aviso | Dependencias con avisos publicados. | Next y eslint-config-next 16.3.5; sustitución del SDK `minio` por `@aws-sdk/client-s3` 3.1131.0 conservando MinIO y objetos existentes; override acotado de esbuild 0.25.12 para la dependencia antigua de drizzle-kit. Audit final: **0** avisos en total y **0** de producción. |

El audit inicial informó 26 entradas de paquetes vulnerables, entre ellas una crítica; no equivale a 26 vulnerabilidades distintas demostradas. El aviso oficial de Next [GHSA-p293-qw3h-jr36](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36) tiene condiciones específicas de plataforma: no se atribuyó esa explotación a este servidor por su URL.

## Validación final

| Comprobación | Resultado |
|---|---|
| `npm run test:security` | 17/17: JWT, roles, IP falsificada, CSRF, límite real/timeout de body, SSRF y DNS fijado, XSS, pertenencia de objetos, retorno, MIME/XML, DOCX malicioso y cifrado AES-GCM. |
| `npm run test:security:integration` | 19/19 solicitudes y escenarios HTTP; incluye nueva compilación de producción y migraciones sobre PostgreSQL aislado. |
| `npm run test:security:storage` | 6/6: creación concurrente de bucket, carga/lectura, stream, Content-Type, descarga acotada y eliminación. MinIO aislado; clave de objeto con espacios y Unicode. |
| `npx tsc --noEmit` | Aprobado. |
| `npx drizzle-kit check` y generación de esquema a `tmp/security-schema-check` | Aprobado; ninguna migración productiva nueva aplicada por esta prueba. |
| `npm audit` / `npm audit --omit=dev` | Cero vulnerabilidades conocidas al cerrar esta revisión. |
| Revisión de rutas y lint | 97/97 archivos API con wrapper. 157 archivos examinados: 7 errores y 15 advertencias de lint; los 7 errores se reprodujeron en HEAD antes de los cambios. Sin errores nuevos de lint en los módulos de seguridad. |
| `git diff --check` | Aprobado. |
| Búsqueda acotada de patrones de secretos | Sin coincidencias en 330 archivos rastreados. No incluye auditoría completa del historial ni verificación de credenciales productivas. |
| Semgrep OSS 1.176.1 (`p/javascript`) | 329 archivos de aplicación, librerías, componentes, esquema y scripts con 74 reglas. Detectó que AES-GCM no imponía un tag de 128 bits; se corrigió. La pasada final sobre los 328 archivos ejecutables quedó sin hallazgos. Marcó HTTP solo en `scripts/security-integration.mjs`: es el servidor `127.0.0.1` del arnés PostgreSQL aislado, no tráfico de la aplicación desplegada. |

Evidencias locales en `output/security/`: `integration-results.json`, `storage-results.json`, `public-check.json`, `npm-audit-final.json`, `npm-audit-production.json`, `review-summary.json`, `lint-final.json`, `lint-baseline.json`, `secret-pattern-check.json`, `semgrep-app.json`, `semgrep-lib.json`, `semgrep-other.json`, `semgrep-lib-after.json`, `semgrep-other-runtime.json` y `semgrep-crypto-after.json`, además de logs de compilación/integración. No publicar este directorio como contenido web.

Semgrep se ejecutó en un contenedor Linux con el repositorio montado de solo lectura porque su binario nativo para Windows falló antes del análisis con `socketpair`. No se instaló Guardian como hook persistente ni se usaron reglas privadas, análisis Pro, análisis de secretos o funciones de IA de Semgrep; por tanto este resultado complementa, pero no reemplaza, esas modalidades ni una revisión manual.

Los errores de lint preexistentes están en páginas de gastos (`any` y enlaces), historial (`any`) y settings (JSX dentro de try/catch). No impidieron TypeScript ni la compilación; no se presentan como un lint global aprobado.

## Lo observado desde Internet

La portada y login respondieron 200; `/admin`, `/dashboard` y `/cases` redirigieron al login. Las rutas sensibles consultadas, como clientes admin, contratos, gastos y descarga de documento, rechazaron acceso anónimo con 401. `/api/v1/settings` respondió 405 a GET, lo cual por sí solo no prueba sus otros métodos. `/.env` y `/.git/config` respondieron 404.

Se observaron redirección HTTP a HTTPS, HSTS, `nosniff`, bloqueo de marcos y CSP básica. Producción todavía anunciaba `X-Powered-By: Next.js`; la corrección local lo deshabilita. La CSP existente no incluye una política estricta para scripts.

Estos resultados no prueban aislamiento entre usuarios productivos, ausencia de ataques anteriores, firewall correcto ni protección volumétrica. No se ha realizado escaneo completo de puertos, prueba de intrusión autenticada en producción ni auditoría del host/imagen/servicios de EasyPanel.

## Despliegue y comprobaciones necesarias

1. Respaldar base de datos y objetos y verificar restauración antes del despliegue. Conservar `ENCRYPTION_KEY`: cambiarla inutiliza las credenciales NetSuite cifradas. Mantener rollback de la imagen anterior.
2. Construir una imagen nueva con `npm ci` y el Dockerfile actualizado. Configurar `NEXT_PUBLIC_APP_URL=https://n8n-docuia.kzkimf.easypanel.host` como argumento de build y variable de runtime; `NEXT_PUBLIC_APP_NAME` es opcional. **No publicar el `.next` de las pruebas**, construido con URL y servicios ficticios locales.
3. Verificar la cadena real de proxy y configurar `TRUSTED_PROXY_HOPS`. El ejemplo usa 1, pero no confirma la topología instalada. El proxy debe añadir/reemplazar X-Forwarded-For correctamente y el puerto de la aplicación debe ser inaccesible directamente. Un valor incorrecto puede bloquear usuarios o confiar en una cabecera falsificada. Con 0, los clientes comparten el origen `unknown` y las allowlists no pueden reconocerlos.
4. Proveer JWT/refresh y credenciales de MinIO/correo reales mediante secretos de EasyPanel. Mantener endpoint, bucket y credenciales existentes de MinIO; no hay migración de archivos. `MINIO_REGION` es opcional y predetermina `us-east-1`. El proveedor de correo debe estar operativo para recuperar contraseñas.
5. Programar nueva autenticación: los tokens antiguos carecen del nuevo propósito/sesión y serán rechazados. Revisar integraciones con API keys: alcances vacíos dejan de conceder acceso. Emitir claves con el permiso mínimo necesario. Clientes de gastos deben actualizarse para enviar el comprobante de carga; cargas sin guardar previas deben repetirse.
6. Probar plantillas Word reales antes de habilitar generación: relaciones externas, hipervínculos externos, macros y algunos campos dinámicos se rechazan deliberadamente. Comprobar fidelidad y tiempos de LibreOffice. Se validó el filtro DOCX, no se completó una auditoría de vulnerabilidades del binario LibreOffice productivo.
7. En EasyPanel/Traefik/CDN, comprobar límites de conexiones, bytes y tiempo antes de llegar a Next; protección volumétrica/WAF; puertos de PostgreSQL y MinIO privados; consola administrativa restringida; buckets no públicos; egreso restringido a los servicios requeridos. Los puertos locales de docker-compose se vincularon a loopback, pero eso no modifica el firewall productivo.
8. Repetir el smoke siguiente en staging y después del despliegue; monitorizar 401/403/413/429 y fallos de correo, almacenamiento y renderizado. Mantener seguimiento periódico de dependencias y actualizaciones del sistema/imagen.

### Smoke autenticado pendiente en el entorno desplegado

- [ ] Login tenant/admin, renovación normal, logout, recuperación por correo y reingreso tras revocación.
- [ ] Dos organizaciones y cada rol: lectura/escritura permitida y rechazo de IDs ajenos; revocación y cambio de rol efectivos con sesión abierta.
- [ ] API key de lectura, escritura y revocada; cliente externo legítimo sin cookies.
- [ ] Factura PDF/XML e imagen real; OCR de gasto y guardado de comprobante; categorías correctas; plantilla Word, generación y descarga PDF.
- [ ] Solicitud desde otro Origin rechazada; llamada legítima desde la URL canónica aceptada; IP de auditoría correcta detrás de la cadena real de proxies.
- [ ] Webhook HTTPS permitido en staging; destino privado/redirección rechazado; TLS válido.
- [ ] Límites de solicitudes observados con fixtures controladas; validación de disponibilidad y rollback sin pruebas de carga sobre datos reales.

## Límites y seguimiento

Quedan fuera de lo verificado: configuración del host/CDN, exposición de otros servicios, políticas reales de MinIO, malware en archivos ya existentes, auditoría de incidentes, restauración de backups, prueba completa de SQLi/lógica de negocio en todos los parámetros, concurrencia de aprobación y sincronización financiera con NetSuite, y resistencia a inyección de instrucciones en documentos procesados por IA. Se deben probar en un entorno controlado con esas integraciones y datos ficticios. No se declara que estén libres de problemas.

La sanitización y las guardas reducen vectores concretos; una CSP estricta con nonces, aislamiento adicional de LibreOffice y límites de concurrencia/costo globales requieren trabajo y validación adicionales. Los límites por usuario implementados no contienen por sí solos ataques distribuidos o la saturación previa al handler.

Referencia del cliente de almacenamiento: [ejemplos oficiales de S3 con AWS SDK JavaScript v3](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/javascript_s3_code_examples.html). La compatibilidad con esta aplicación se verificó mediante el contenedor MinIO descrito, no se dedujo solamente de la documentación.
