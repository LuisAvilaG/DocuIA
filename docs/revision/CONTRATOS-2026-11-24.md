# Revisión del módulo Contratos — 24 de noviembre de 2026

Rama `feat/rediseno-fase-0` (commit 3eee974). Revisión por lectura de código en tres frentes (seguridad, lógica del servidor, pantallas), más pruebas con scripts sobre las funciones puras. Nada se ejecutó contra la base de datos, el proveedor de IA ni la app en el navegador. No se cambió código.

## Estado de partida

- Tipos (`tsc --noEmit`): sin errores.
- Lint del módulo: 0 errores, 1 aviso (`<img>` en `visual-training-workspace.tsx:225`).
- Tests de contratos: 33 de 33 pasan.
- Sin ningún test: `approval-state`, `revalidate`, `flow-versions`, `upload-links` (solo un helper), `validation-rows`, `status`, `home`, `presets`, `word-to-pdf`, `document-pages`, `trace`, `rule-from-text`, `archive-case-sync`, `archive-validations`. Ninguna ruta del API de contratos tiene test (transiciones de estado, permisos, aislamiento por organización).

## Resumen

| Nivel | Cantidad |
|---|---:|
| Graves | 3 |
| Importantes | 20 |
| Menores | 33 |
| Decisiones de producto pendientes | 5 |

Lo bueno, verificado: todas las consultas están acotadas a la organización de la sesión (no se encontró ningún IDOR); el token de entrega pública es de 256 bits, guardado como hash, de un solo uso y con vencimiento; las descargas llevan CSP `sandbox` y `nosniff`; el HTML de las plantillas se sanea y el PDF se genera sin pedir nada a la red (sin SSRF); la conversión Word→PDF usa `execFile` sin shell; aprobar y rechazar bloquean la fila del caso.

**Verificación.** Comprobé personalmente G1, G2, G3, I1, I2, I3 e I5 leyendo el código (y midiendo G1 y G2). El resto lo confirmó el revisor de cada frente leyendo el código; los que llevan «confianza media» dependen de un comportamiento que no se pudo ejecutar.

---

## Graves

**G1 · Una expresión regular cúbica puede congelar el servidor para todos los clientes** · `lib/contracts/reference-codes.ts:15`
- Resultado (25 nov): corregido. El texto se lee con los espacios ya unidos y cada repetición está acotada; 200.000 espacios tras «CARTA N» tardan unos 4 ms. Test: `tests/contract-review-graves.test.ts`.
- El patrón `CODE` encadena `\s*(?:N\s*[°º.o]*\s*)?[-:/]?\s*`; con «CARTA N» seguido de muchos espacios y sin número, el retroceso crece al cubo.
- Medido: 1.000 espacios → 97 ms, 2.000 → 721 ms; 5.000 → 27 s; 10.000 → más de 2 min.
- Corre en `detectReferences`, que indexa cada documento del Archivo y, con el Archivo de referencias activo, cada documento de cada caso (incluidos los que sube un contratista sin sesión por `/entregar`). El worker de la cola vive en el mismo proceso de Next (`instrumentation.ts`): mientras la regex corre, no responde nadie.
- Arreglo: acotar los cuantificadores (`\s{0,5}`), colapsar espacios del texto antes de buscar y limitar el tamaño de página analizado.

**G2 · La validación de plantillas Word se puede colgar horas con un archivo de ~5 KB** · `lib/security/docx.ts:99` (y `:22`, `:35`, `:47`)
- Resultado (25 nov): corregido. Los patrones se detienen en el siguiente «<»; además se rechazan los documentos con etiquetas sin cerrar («El documento Word está dañado»), que también hacían lentas las plantillas al generar (`word-template.ts`). De paso se cerraron dos formas de esconder un campo peligroso: un «<» codificado (`&#60;`) y una sección CDATA. Test: `tests/contract-review-graves.test.ts`.
- `<[^>]*altChunk\b` es cuadrática sobre una cadena de «<». Medido: 20.000 → 103 ms, 40.000 → 409 ms, 80.000 → 1,7 s; una parte XML de 5 MB (el límite) son horas de CPU. Comprimida pesa unos 5 KB.
- El `setTimeout` de 15 s no sirve: la regex es síncrona y bloquea el bucle de eventos.
- La alcanza cualquier usuario con escritura en contratos que suba un Word como documento (`finishUpload` → `validateDocx`), y los administradores por plantilla Word e importación de flujo.
- Arreglo: `<[^<>]*altChunk`, o buscar los literales con `indexOf` / un tokenizador XML lineal; validar en un `worker_thread` con tiempo límite real.

**G3 · Un documento corregido no reemplaza al original: la corrección no cambia el resultado** · `lib/contracts/upload-links.ts:110`, `lib/contracts/validate.ts:39`, `app/api/v1/contracts/cases/[id]/generate/route.ts:44`, `app/(tenant)/contracts/[id]/resubmit-panel.tsx:59`
- Resultado (25 nov): corregido según D5 (gana el más reciente). Análisis, correcciones, condiciones de aprobación, cálculos y documento generado leen los documentos de un tipo del más reciente al más antiguo (`newestFirst` en `validate.ts`). En las validaciones de listas, lo que se revisa (los firmantes) sale del documento más reciente y dónde se busca (los representantes) sigue juntando todos los documentos del tipo, para no romper los consorcios. Pendiente: quitar un documento del caso y la copia vieja en el Archivo (M-12). Sin probar con la base de datos.
- La entrega pública inserta los archivos nuevos sin reemplazar nada; el reingreso interno trae «Documento nuevo» por defecto.
- Validaciones, cálculos, condiciones de aprobación y documento generado toman el **primer** documento del tipo que tenga el dato (`firstValue`; generate ordena por `createdAt asc`; el pipeline lee sin orden).
- Escenario: se pide «Póliza corregida» porque el valor asegurado está mal → el contratista la sube → el caso se reanaliza → el hallazgo reaparece con el valor viejo. No hay forma de quitar un documento del caso. La copia vieja sigue «lista» en el Archivo y vuelve ambiguas las referencias a ese código (ver M-12).
- Arreglo: que gane el más reciente del mismo tipo; que la solicitud recuerde qué documento se pide y la entrega lo reemplace; preseleccionar el reemplazo en el reingreso; permitir «Quitar del caso» antes de la decisión. **Ver decisión D5.**

---

## Importantes

### Aprobación

**I1 · Bloqueo con aprobadores de excepción y un paso de personas concretas** · `lib/contracts/approval-rules.ts:60-70`
Con un bloqueo y lista de excepción, solo esas personas pasan la primera comprobación, pero después solo pueden firmar un paso que las nombre o uno «cualquiera». «Siempre» = [Jurídica], excepción = [Director], caso con bloqueo: Jurídica recibe «solo las personas autorizadas…» y Director «Este paso lo decide otra persona». El caso solo puede rechazarse; el editor no lo impide. **Ver decisión D4.**

**I2 · Bloqueo cuando la misma persona está en dos pasos** · `lib/contracts/approval-rules.ts:68` (C1 corregido solo en parte)
Se asigna el primer paso pendiente que nombra a quien firma, no el más restringido. «Siempre» = [A, B], «Monto alto» = [A]: A firma primero y se le asigna «Siempre»; B no puede firmar «Monto alto» y A ya firmó. Pasa igual con el respaldo de administradores (`approval-state.ts:124-128`). Arreglo: asignar el paso con menos aprobadores elegibles (o emparejar antes de aceptar la firma).

**I3 · Un monto ilegible desactiva la aprobación adicional (falla abierta)** · `lib/contracts/approval-rules.ts:30-31`
`if (v === null) return;`. Con «$1.500.000.000 más IVA 19 %», «COP 2.500 millones» o «USD 1,5 billones» la condición «valor > 1.000 M → Director» no se agrega y un solo aprobador cierra el caso. Tampoco se entienden «mil», «millones», «MM». **Ver decisión D3.**

**I4 · Se permite la autoaprobación cuando no hay aprobación por reglas** · `app/api/v1/contracts/cases/[id]/approve/route.ts:82-102`
La regla «quien crea no aprueba» solo se aplica dentro de `if (rules)`. Sin la función de reglas o sin etapa Aprobación en el flujo, quien sube el caso lo aprueba, también con bloqueos si escribe un motivo. **Ver decisión D1.**

**I5 · Los pasos se calculan fuera del bloqueo de la fila** · `approve/route.ts:38` frente a `:43`
Si un administrador sube el monto de 400 M a 600 M entre `caseApprovalRules()` y el `FOR UPDATE`, la firma se evalúa con los pasos viejos y el caso se aprueba sin el paso por monto. Tampoco se comprueba que el aprobador vio los datos vigentes. Arreglo: calcular los pasos dentro de la transacción y enviar `expectedUpdatedAt` desde el cliente.

**I6 · La bandeja y el formulario se ofrecen a quien el API no deja firmar** · `approvals/page.tsx:46-99`, `approvals-client.tsx:186,312`, `[id]/decision-panel.tsx:50,133`
Al creador, a quien no está asignado, a quien ya firmó o (con bloqueo) a quien no es de excepción. Escribe la justificación, marca las validaciones, sube el soporte y recibe 403 al final. Los pasos dicen «2 personas asignadas» sin nombres. Arreglo: evaluar `checkApproval` por caso y usuario en el servidor; separar «Te toca» de «Espera a otra persona»; nombrar a los aprobadores.

**I7 · Las firmas parciales se anulan sin aviso** · `lib/contracts/revalidate.ts:116-121`, `lib/contracts/pipeline.ts:402`
Una corrección borra `approvals` y guarda `approvalsReset`, que ninguna pantalla lee; el reanálisis las borra sin siquiera esa marca (C21 en parte). Quien firmó vuelve y ve su paso «Pendiente» sin explicación. Arreglo: aviso en Decisión y evento en Actividad y auditoría.

**I8 · Un operador puede neutralizar bloqueos de referencias sin aprobar con excepción** · `app/api/v1/contracts/archive/references/[id]/route.ts:13-39`
Basta permiso de escritura: confirmar la referencia contra cualquier documento listo deja la validación en `ok=true` y el aprobador ve el caso limpio, sin motivo ni marca de revisión. Corregir un dato es solo de administradores; esto no. Los registros de auditoría de estas rutas no guardan el correo. **Ver decisión D2.**

### Análisis (pipeline)

**I9 · El análisis no es idempotente y puede pisar un caso ya decidido** · `lib/contracts/pipeline.ts:161,380,401-420`, `reprocess/route.ts:29-33`
Pone «processing» sin condición, borra y reinserta validaciones antes del bloqueo y escribe el resultado final sin exigir que el caso siga en proceso. El error marca «failed» y pg-boss reintenta (2 veces, backoff de 30 s).
- Si el usuario pulsa «Volver a analizar» durante el backoff corren dos análisis: doble gasto de IA, y si el reintento falla al final deja «failed» un caso ya validado.
- Si un documento largo pasa las 2 h de vida del trabajo, pg-boss lo reintenta con el primero vivo; si entretanto se aprobó, el segundo deja el caso «validated» y sin `decision` ni `approvals` (solo queda en la auditoría).
- Dos ejecuciones solapadas pueden duplicar validaciones. Al terminar bien no se limpia `errorMessage`.
Arreglo: tomar el caso con `UPDATE … WHERE status IN ('uploaded','failed') RETURNING` y un identificador de ejecución; escribir solo si la ejecución sigue siendo la dueña; rechazar el reproceso con un trabajo vivo.

### Flujos

**I10 · Publicar puede dejar activo un flujo vacío o roto** · `lib/contracts/flow-versions.ts:51-59`, `flow/[id]/route.ts:98-104` (C10 en parte)
Las comprobaciones de activación solo están en el PATCH de activar. Publicar un borrador sin etapas sobre el flujo activo da casos «ok» sin controles; agregar «rastreo de referencias» sin el Archivo hace fallar todos los casos. Arreglo: una función común llamada al activar, al publicar y al guardar sin versiones.

**I11 · Los cambios a flujos no dejan auditoría** · `flow/route.ts`, `flow/[id]/route.ts`, `flow/import`, `word-template`, `variants/**`, `ai-analysis/templates`
Sin versiones de flujo, un administrador puede asignarse la aprobación, subir un umbral o vaciar la lista de excepción sin rastro. Tampoco se audita la descarga de documentos fuente ni de soportes. Arreglo: `logAudit` con el diff (`diffFlows` ya existe).

**I12 · El editor de flujos pierde el trabajo sin avisar** · `flow/client.tsx:900-905,1043,1099`
No hay detección de cambios sin guardar ni `beforeunload`; «← Flujos», el menú o recargar descartan todo; Supr borra una etapa sin deshacer.

### Seguridad

**I13 · Inyección de instrucciones desde documentos de terceros** · `lib/contracts/ai-analysis.ts:102-115`, `lib/contracts/extract.ts:82`
Los valores extraídos van junto a las instrucciones sin marcarse como datos no confiables (el Archivo sí lo hace, `archive.ts:54`), y el nombre del archivo, que elige el contratista, va dentro de la instrucción de sistema. Un PDF con texto oculto puede inclinar el `pass` del análisis IA o un monto que decide la aprobación. Arreglo: delimitar el contenido como dato no confiable, sacar el nombre del prompt de sistema, que un `pass` de IA no levante bloqueos deterministas y marcar en pantalla los casos con entrega externa.

**I14 · Un enlace de entrega válido permite agotar la memoria** · `lib/security/http.ts:121-146`, `app/api/public/entregar/[token]/route.ts:17-26`
El límite de 6 por hora se aplica después de que el envoltorio ya leyó hasta 61 MB; luego se copia varias veces. Muchas peticiones concurrentes con el mismo enlace pueden tumbar el proceso. Cada intento que pierde la carrera deja archivos huérfanos en el almacenamiento (`upload-links.ts:94-99`). Confianza media (las cifras de memoria son estimadas).

### Pantallas

**I15 · «Reabrir el caso» con un clic, sin confirmación ni motivo** · `decision-panel.tsx:113`, `reopen/route.ts:33-43`
Quita el documento generado (lo pasa a `outputHistory`, que ninguna pantalla muestra), borra todas las firmas y devuelve el caso a «Por decidir». La actividad solo dice «Caso reabierto».

**I16 · Los diálogos no manejan el foco** · `decision-dialog.tsx:383-400`, `new-case-dialog.tsx:130`, `flows-list-client.tsx:263`, `word-template-workspace.tsx:292`, `visual-training-workspace.tsx:208`
Declaran `aria-modal` pero no ponen, atrapan ni devuelven el foco. `components/kit/drawer.tsx` sí lo hace.

**I17 · Fechas sin zona horaria: hora equivocada y error de hidratación** · `approvals-client.tsx:162`, `resubmit-panel.tsx:147,155`, `metrics-client.tsx:134,151,224`, `quality-client.tsx:242`, `cases/view.tsx:161`
El servidor (UTC) pinta una hora y el navegador otra: en Bogotá «20:05» pasa a «15:05» con error de hidratación.

**I18 · Cada vista previa audita y vuelve a convertir el Word** · `cases/[id]/output/route.ts:44,47`
Con las vistas previas nuevas en Aprobaciones y Documento, recorrer 20 casos son 20 eventos de auditoría y 20 conversiones Word→PDF; regenerar carga dos veces (`case-output.tsx:268`). Arreglo: no auditar `?preview=1`, guardar el PDF convertido.

### Otros del servidor

**I19 · Pedir documentos y reabrir pisan cambios concurrentes** · `request-documents/route.ts:70-83`, `reopen/route.ts:30-45`
Leen `resultJson` sin bloqueo: pedir documentos puede borrar una firma recién hecha; reabrir puede perder un documento generado en paralelo (archivo huérfano). Arreglo: la misma transacción con `FOR UPDATE` que ya usa rechazar.

**I20 · Correcciones simultáneas en dos documentos del mismo caso** · `documents/[id]/route.ts:65-73`
Cada corrección recalcula validaciones con el valor viejo del otro documento; la última gana con un veredicto inconsistente con los datos guardados.

---

## Menores

Servidor y seguridad
- M-1 · `documents/[id]/route.ts:51` · `fieldKey in values` acepta «constructor», «toString»; se guarda y puede ir a los aprendizajes. Usar `Object.hasOwn`.
- M-2 · Siete rutas devuelven `error.message` crudo (`cases/route.ts:136`, `resubmit:23`, `uploads:18`, `uploads/[id]:13`, `parts:16`, `archive:48`, `ai-analysis/improve:19`); un error de drizzle incluye el SQL y sus parámetros.
- M-3 · `request-documents` permite enviar texto libre (4.000 caracteres) desde noreply a cualquier dirección y repetirlo cancelando: vector de spam/phishing. Limitar por organización y día, auditar el destinatario.
- M-4 · El secreto del cron se compara con `===` (`cron/approval-reminders/route.ts:8`); usar `timingSafeEqual`.
- M-5 · Las plantillas de análisis IA guardan `body.config` sin esquema y `description` sin largo máximo (`ai-analysis/templates/route.ts:73-77`).
- M-6 · Ocho rutas no comprueban que el producto siga activo (`cases/[id]` GET, `findings`, `support`, `resubmit`, `documents/[id]/file`, DELETE de `request-documents`, `learnings`, `variants/[variantId]/file`).
- M-7 · Una entrega de 10 PDF de 1.500 páginas en blanco dispara hasta 15.000 OCR (`document-pages.ts:15,73`). Limitar páginas por entrega externa.
- M-8 · Quien corrige un monto (admin) puede después firmar «Siempre»: `noSelfApproval` solo excluye al creador.
- M-9 · Si la única persona de un paso es quien creó el caso, nadie puede firmarlo; el respaldo de administradores solo cubre inactivos.
- M-10 · El reingreso interno no revoca el enlace pendiente, y con `upload_link=false` una nueva solicitud no revoca los anteriores (`uploads.ts:155`, `request-documents/route.ts:88`).
- M-11 · Sin flujo de aprobación, corregir un campo después de generar deja vigente el documento con datos viejos (`revalidate.ts:117,130`).
- M-12 · Dos documentos listos con el mismo código en el Archivo vuelven «ambiguas» todas sus referencias, y cada indexación reevalúa con IA todas las referencias no revisadas (`archive.ts:73-81`).
- M-13 · Redondeo de negativos: −2,5 → −2 y aparece «-0» (`calculations.ts:181,212`).
- M-14 · Formato «moneda» de Word fijo en «COP» y `es-CO` (`word-template.ts:131,145`; el taller solo ofrece «Moneda COP»). En pantallas también `es-CO` fijo (`[id]/page.tsx:34`, `case-calculations.tsx:8`, `approvals-client.tsx:36`).
- M-15 · Recordatorios: `limit 500` sin orden (los mismos 500 siempre), ~4 consultas por caso y días hábiles en la zona del servidor (`approval-reminders.ts:35`).
- M-16 · C15 sigue abierto: el editor inserta `{{campo}}` sin el tipo de documento y el generador toma el primer documento de cualquier tipo.
- M-17 · C29 sigue abierto: «CARTA 199-26» no enlaza con «CARTA 199-2026».

Pantallas
- M-18 · «Corregir» se ofrece en casos aprobados, rechazados, esperando documentos o con error; el API responde 409, y con «Esperando documentos» dice «ya tiene una decisión» (`case-documents.tsx:240,247`).
- M-19 · Archivo ofrece agregar, confirmar y descartar al rol de solo lectura; la carga sube el archivo antes de fallar (`archive/page.tsx:11`).
- M-20 · Archivo: el diálogo se cierra aunque la carga falle, `response.json()` sin captura («Unexpected token <»), la búsqueda no cancela peticiones anteriores y la lista se corta en 100 sin paginar (`archive/client.tsx:52-158`, `archive/route.ts:28`).
- M-21 · D29 en parte: el fondo sigue cerrando la plantilla Word y el entrenamiento visual con pérdida de trabajo, sin Escape; «Quitar marca» es un `span` dentro de un `button` (inaccesible por teclado); la columna de campos desaparece bajo 1024 px.
- M-22 · `decision-dialog.tsx:302` no mira `r.ok` al pedir hallazgos: con error la lista queda vacía y el API responde un 400 confuso.
- M-23 · Actividad no muestra el comentario de la aprobación, cuántas validaciones se marcaron ni el soporte (`case-activity.tsx:356`).
- M-24 · El nombre de descarga pierde tildes y espacios: «Contrato de Concesión.pdf» → «Contrato_de_Concesi_n.pdf» (`documents/[id]/file/route.ts:40`).
- M-25 · Términos inconsistentes: «Recordar» frente a «Guardar y aprender»; «Con hallazgos» cuenta solo bloqueos en Métricas y también advertencias en Casos; «advertencias» frente a «a revisar»; «transmittals»; el lienzo anuncia textos en inglés («zoom in…») por no usar `ariaLabelConfig`.
- M-26 · Selector propio del editor sin teclado ni roles (`flow/client.tsx:764-794`); `<select>` sin etiqueta y condición solo con placeholder (`approval-form.tsx:26,100`).
- M-27 · Rendimiento: el editor importa pdf.js aunque no se entrene nada (`flow/client.tsx:19`); `displayNodes` recrea datos en cada tecla; Aprobaciones manda hasta 800 casos al cliente.
- M-28 · Nuevo caso: «Crear y analizar» se reactiva antes de navegar (doble envío) y Escape descarta archivos ya subidos sin confirmar (`new-case-dialog.tsx:55,120-130`).
- M-29 · «Última actividad» de Métricas sin título ni enlace; tipos de documento con la clave cruda.
- M-30 · Con la generación apagada después, la pestaña por defecto da 403; con la aprobación apagada después, «Generar documento» da 409.
- M-31 · El reingreso dice «puede subirlos hasta el X» aunque X ya pasó (`resubmit-panel.tsx:155`).
- M-32 · Pestañas sin `tabpanel` ni flechas; el estado de cada etapa no se anuncia a lectores de pantalla.
- M-33 · Aprobaciones: los contadores ignoran el filtro de flujo, «espera hace X» se reinicia con cada firma o corrección, y el orden es de más nuevo a más viejo. Casos heredados en estado `review` no tienen salida (nada escribe ese estado hoy). D28 sigue en parte: subrayado, alineación y resaltado no llegan al PDF.

---

## Decisiones de producto pendientes

| # | Pregunta | Recomendación |
|---|---|---|
| D1 | ¿Quien crea un caso puede aprobarlo cuando no hay aprobación por reglas? (I4) | No, salvo administradores, igual que en Gastos |
| D2 | ¿Quién puede confirmar o descartar referencias del Archivo, y cuenta como resuelta? (I8) | Aprobadores y administradores; queda como «revisada por X», visible al decidir, no como «ok» |
| D3 | Si el monto de una condición de aprobación no se puede leer (I3) | Exigir el paso adicional (fallar cerrado) y mostrar el aviso |
| D4 | Con bloqueo, ¿qué firma una persona de excepción? (I1) | Cualquier paso pendiente; el editor avisa si la lista no cubre todos |
| D5 | Documento corregido (G3) | El más reciente del mismo tipo gana; la solicitud dice qué documento reemplaza; se puede quitar un documento antes de decidir |

Respuestas (25 nov): D2 y D3, se dejan como están. D5, gana siempre el documento más reciente del mismo tipo. D1 y D4 se resuelven con un módulo nuevo, el «Mapa de aprobaciones», dibujado en la sección 14 del lienzo de diseño de Contratos; falta programarlo.

---

## Mejoras de producto (por prioridad)

1. **Vencimientos y obligaciones (L).** Hoy las fechas solo se validan al analizar (`home.ts` lo admite: «Sin vencimientos»). Una vista de vencimientos de contratos y pólizas con alertas a N días, reutilizando el cron de recordatorios.
2. **Bandeja personal con plazos (M).** «Te toca», «Espera a otra persona», «Vencidos»; espera medida desde la validación; de más antiguo a más nuevo; plazo por flujo. Resuelve también I6 y M-33.
3. **Historial de decisiones y expediente exportable (M).** `decisionHistory`, `outputHistory`, `documentRequests` y `approvalsReset` se guardan y no se muestran. Expediente PDF con documentos, hallazgos, firmas y soportes para auditoría legal.
4. **Comparar versiones de un documento (M).** Al reemplazar, qué datos cambiaron y qué hallazgos se resolvieron. Complementa G3.
5. **Delegación por ausencia (M).** Delegar con rango de fechas, con registro de quién firmó por quién.
6. **Avisos (M).** Al quedar «Por decidir», y a quien creó el caso cuando se aprueba, rechaza o falla. Hoy solo hay recordatorios con aprobación por reglas.
7. **Búsqueda por contenido (M).** Hoy Casos busca solo por título. Contratista, NIT, número de contrato y rango de monto sobre los datos extraídos.
8. **Exportar a Excel/CSV (S-M).** Casos y Aprobaciones con datos, cálculos, veredicto y decisión.
9. **Gestión de hallazgos (M).** Marcar un hallazgo como resuelto o aceptado con nota y asignarlo antes de decidir.
10. **Aprobar en lote (M).** Casos «Sin observaciones» del mismo flujo con un comentario; reanalizar en lote los fallidos.
11. **Enlace del contratista (S).** Mostrar vencido, recordatorio automático, y que el contratista indique qué documento reemplaza.
12. **Formato regional por organización (S-M).** Moneda y separadores por cliente en pantalla, Word y PDF (M-14).
13. **Tests del API (M).** Transiciones de estado, permisos por rol y aislamiento por organización de las rutas de contratos; hoy ninguna ruta tiene test.

---

## Cobertura

Leídos completos:

- **Seguridad:** todas las rutas `app/api/v1/contracts/**`, `app/api/public/entregar/[token]`, `app/entregar/[token]/*`, `app/api/internal/cron/approval-reminders`; `lib/security/*`, `lib/auth/jwt.ts`, `permissions.ts`, `rate-limit.ts`, `lib/storage/*`, `proxy.ts`; en `lib/contracts`: `upload-links`, `document-requests`, `uploads`, `upload-client`, `word-template`, `word-to-pdf`, `generate`, `flow-transfer`, `rule-from-text`, `ai-analysis`, `pipeline`, `extract`, `archive*`, `approval-*`, `revalidate`, `flow-versions`, `flow-test`, `reference-codes`.
- **Lógica:** los 45 archivos de `lib/contracts/`, `lib/numbers.ts`, `lib/stats/contract-metrics.ts`, `db/schema/contracts.ts`, `db/schema/contract-archive.ts`, la parte de contratos de `lib/queue/index.ts`, `cron/reap-stuck`, y todas las rutas del API de contratos. Las migraciones se revisaron con búsquedas (no hay claves foráneas).
- **Pantallas:** todo `app/(tenant)/contracts/**` (incluido el editor de 1.192 líneas), `app/(tenant)/cases/*`, `app/entregar/[token]/*`, `components/kit/stage-nav.tsx`, `PRODUCT.md`, y el código de los commits 3eee974, 6a6bf6a, f92351f y c747a48.

Leídos en parte: `lib/flow.ts` (seguridad, 1-200), `plan.ts`, `document-pages.ts`, `lib/email/send.ts`, `lib/features/index.ts`, `instrumentation.ts`, `DESIGN.md` (primeras 150 líneas).

No verificable sin ejecutar: comportamiento real de pg-boss al vencer un trabajo largo (I9-B), consumo de memoria de la entrega pública (I14), efecto real de una inyección en el modelo (I13).
