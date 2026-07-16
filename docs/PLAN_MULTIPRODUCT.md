# DocuIA — Plan: plataforma multi-producto + Contract Intelligence

> **Reframe:** DocuIA es una **plataforma de procesamiento de documentos con IA**.
> NetSuite deja de ser el centro y pasa a ser *un destino opcional de ciertos
> productos*. Los **productos** son ciudadanos de primera clase; un cliente puede
> tener 1, 2 o los 3, y el onboarding empieza por **elegir producto**.

Productos:
1. **AP Automation** — facturas/OC → NetSuite (existente).
2. **Expense Management** — reportes de gastos → NetSuite (existente).
3. **Contract Intelligence** — análisis/validación/generación documental con IA (**nuevo, sin integración por ahora**).

Decisiones ya tomadas (no reabrir):
- Navegación: **sidebar unificado con secciones por producto**.
- Empaquetado: **à la carte** — `org_products` es la fuente de verdad del acceso.
- Onboarding: **primer paso = selector de tarjetas de producto**; config condicional (Contratos sin NetSuite).
- IA de Contratos: **Gemini** (reusar el pipeline existente).
- v1 de Contratos: **incluye generación por plantilla** + export PDF.
- Contratos es **motor genérico configurable**; lo vertical (tipos de doc, campos, reglas, plantillas) se configura **por cliente** vía playbooks/presets. "Seguros de Garantía Chile" = un playbook precargado.

---

# PARTE A — Plataforma multi-producto

## A1. Modelo de datos

**Nuevas tablas**
- `products` — catálogo (key, name, description, icon, `requires_integration` bool, `sort_order`). Seed: `ap_automation`, `expense_management`, `contract_intelligence`.
- `org_products` — qué productos tiene cada org: `(organization_id, product_key, status['active'|'trial'|'disabled'], config_json, enabled_at)`. **Unique (org, product)**. Fuente de verdad del acceso (à la carte).

**Features → productos**
- Agregar `product_key` (nullable) a `features`. `null` = feature de **plataforma** (compartida).
- Mapa inicial:
  - `ap_automation`: ai_tiered_fallback, ai_force_secondary, ai_model_selection, ai_validation_thresholds, auto_mapping, po_processing, netsuite_dry_run, approval_workflow, duplicate_detection, bulk_upload, exception_queue, custom_netsuite_forms, auto_sync, sync_advanced.
  - `expense_management`: expense_management, expense_approval, expense_categories_sync.
  - `contract_intelligence`: (nuevas — ver Parte B).
  - **Plataforma (product_key=null):** webhook_system, api_keys, scheduled_reports, advanced_analytics, data_export, data_retention, document_storage, ip_allowlist, tenant_audit_log, white_label.
- `isFeatureEnabled(org, feature)` gana un guard previo: si la feature pertenece a un producto y ese producto no está en `org_products` activo → false. Así el acceso se resuelve por producto y las features solo afinan dentro del producto.

## A2. Onboarding rediseñado (product-first)

Flujo actual: **info del cliente → NetSuite (7 pasos)**.
Flujo nuevo:
1. **Selector de tarjetas de producto** (multi-select): AP / Expenses / Contract Intelligence. Cada tarjeta dice qué configura y si requiere integración.
2. **Info del cliente** (org, plan, admin) — común.
3. **Config condicional por producto seleccionado:**
   - AP / Expenses → sub-flujo **"Conectar NetSuite"** (el wizard NS actual, extraído como componente reusable; solo aparece si se eligió un producto que lo requiere).
   - Contract Intelligence → sub-flujo **"Configurar playbook"**: elegir preset (ej. *Seguros de Garantía CL*) → tipos de documento, campos por tipo, reglas de validación, plantilla de salida (editables).
4. Resumen y creación → inserta `org_products` + features grantadas por producto.

Impacto: NetSuite deja de ser obligatorio; un cliente **solo-Contratos** completa el alta sin tocar NS.

## A3. Navegación (sidebar unificado con secciones)

- `tenant-sidebar.tsx` pasa de lista plana a **secciones por producto habilitado**. Cada sección = un producto (título + sus módulos), gateada por `org_products` + feature.
  - **AP Automation:** Dashboard, Workflow, Historial, Excepciones, Mapeos, Catálogos, Estadísticas.
  - **Expenses:** Gastos (+ subvistas).
  - **Contract Intelligence:** Casos/Análisis, Documentos, Plantillas, Alertas.
  - **Plataforma (siempre):** Configuración, Equipo, API Keys, Webhooks.
- Fuente de nav declarativa: `lib/products/registry.ts` (producto → módulos → feature/rol). El sidebar lo consume y filtra por `org_products`.

## A4. Migración de orgs existentes (backfill)

- Migración de datos: por cada org, si tiene alguna feature de `ap_automation` activa → insertar `org_products(ap_automation)`; si tiene `expense_management` → insertar `org_products(expense_management)`. Idempotente. Cero cambio visible para clientes actuales.

## A5. Billing (nota)
Los productos son la unidad natural de venta à la carte. El enforcement de planes/pagos sigue como deuda pendiente (Stripe); el modelo `org_products` ya deja el terreno listo.

---

# PARTE B — Contract Intelligence (motor genérico)

## B1. Concepto
Motor de **análisis + validación cruzada + generación** documental, configurable por cliente. Un "caso" agrupa varios documentos relacionados; el sistema los clasifica, extrae campos con **trazabilidad clicable**, **valida cruzando documentos** con reglas declarativas, y **genera un documento de salida** desde plantilla. Sin integración externa (export PDF); destino pluggable a futuro.

## B2. Reuso de infraestructura existente (clave)
| Necesidad | Reuso |
|---|---|
| Procesamiento asíncrono | cola pg-boss + worker (nuevo job `contract-pipeline`) |
| Extracción/OCR IA | `lib/workflow/extract.ts` generalizado (Gemini multimodal, escaneos nativos, paginado) |
| Split view datos↔documento | patrón `review-client.tsx` |
| Trazabilidad | **citas de texto** (6–12 palabras) + resaltado por búsqueda tolerante sobre la capa de texto/OCR (más robusto que bbox para layouts variables); bbox donde exista |
| Motor de reglas | patrón `lib/expense/tax-engine.ts` (reglas declarativas + razón explicable) |
| Storage | MinIO |
| Auditoría (NCG 454) | `tenant_audit_log` (ya incondicional) |
| Alertas de vencimiento/renovación | crons + email + webhooks |
| Aprobación | patrón `approval_workflow` |

## B3. Modelo de datos (nuevas tablas, con `product_key='contract_intelligence'`)
- `contract_doc_types` — tipos de documento configurables por org (`key`, `name`, `classification_hint`). Preset seguros: contrato, escritura_poderes, certificado_vigencia.
- `contract_field_schemas` — campos por tipo de doc, **versionados por org** (`doc_type`, `field_key`, `label`, `type`, `is_list`, `sort`). Editable en el schema builder.
- `contract_validation_rules` — reglas declarativas de vinculación (`name`, `applies_to`, `conditions_json`, `status_on_pass/fail/unknown`, `reason_template`). Preset: validación de firmantes (apoderado en escritura ∧ certificado vigente ∧ forma de actuación compatible).
- `contract_output_templates` — plantillas de salida por org (`name`, `body`, `letterhead_asset`, `mapping_json`). Preset: cotización seguro de garantía.
- `contract_cases` — caso/análisis (`org`, `status`, `created_by`, resultado).
- `contract_documents` — docs del caso (`case_id`, `storage_key`, `detected_type`, `ocr_mode['digital'|'scanned'|'mixed']`, `extracted_json`, `citations_json`).
- `contract_validations` — resultado por entidad validada (`case_id`, `subject`, `status`, `reason`, `checks_json`, `citation`).
- `contract_obligations` — obligaciones/fechas clave extraídas (`case_id`, `type`, `due_date`, `alert_at`) para alertas.

## B4. Pipeline (job `contract-pipeline` en la cola)
1. **Clasificar** cada documento por función legal (Gemini) — no por autodenominación.
2. **Detección de ruta de lectura** (digital / escaneado / mixto) — heurística del doc (cobertura de capa de texto) → Gemini multimodal para escaneos, con **paginado por lotes** (sin límite duro de 30; configurable).
3. **Extraer** los campos del `contract_field_schema` del tipo detectado; cada campo trae **cita literal** (array de citas para listas). Regla estricta: **no inventar** → NO ENCONTRADO / [POR COMPLETAR].
4. **Trazabilidad**: persistir citas; en UI, clic en dato → resalta cita (búsqueda tolerante a espacios/saltos; toggle escaneo/texto detectado).
5. **Vinculación**: correr `contract_validation_rules` cruzando documentos → estado + razón + checks por entidad (ej. firmante).
6. **Obligaciones/fechas** → `contract_obligations` (+ alertas vía cron/email/webhook).
7. **Generación** (v1): render de `contract_output_template` con datos + [POR COMPLETAR] → **export PDF sobre membrete**.

## B5. Config por cliente (schema/rules/template builder) + presets
- El "vertical" vive en config, no en código. Al crear un cliente Contratos: elegir **playbook preset** (ej. *Seguros de Garantía CL*) que precarga tipos de doc, campos, reglas y plantilla; luego editable sin código.
- Comparación de nombres tolerante a OCR (mayúsculas/tildes/orden/typos 1–2 letras) como utilidad compartida del motor de reglas.

## B6. Diferenciadores competitivos (más que el demo)
- **Server-side, multi-tenant, con auditoría** (el demo corre en browser con API key expuesta).
- **Motor genérico** → sirve NDAs, obra, due diligence, KYC, arrendamientos… no solo seguros.
- **Obligaciones + alertas de renovación/vencimiento** (su roadmap → nuestro v1).
- **Auditoría regulatoria** casi gratis (NCG 454).
- v2: **playbook de cláusulas + scoring de riesgo + detección de desviaciones (redline)**.

## B7. Generación de PDF (sub-decisión técnica)
`jsPDF` del demo es de navegador. Server-side propongo **plantilla HTML → PDF** (headless) o `pdf-lib`. Recomiendo HTML→PDF por flexibilidad de membrete/plantillas. **Pendiente de confirmar la librería** al llegar a P11.

---

# PARTE C — Ejecución por fases (con QA gate por fase)

- **P6 — Fundación de productos:** tablas `products`/`org_products`, `product_key` en features, guard en `isFeatureEnabled`, backfill de orgs existentes, `lib/products/registry.ts`. *(sin cambio de UI visible)*
- **P7 — Onboarding product-first:** selector de tarjetas + info + config condicional; extraer wizard NS como sub-flujo reusable.
- **P8 — Navegación unificada:** sidebar por secciones desde el registry, gateado por `org_products`.
- **P9 — Contratos: dominio + pipeline base:** schema, job `contract-pipeline`, clasificación + extracción configurable + trazabilidad + UI de caso/review.
- **P10 — Motor de validación cruzada:** reglas declarativas + estados + razones + checks (preset firmantes).
- **P11 — Generación por plantilla + PDF:** template engine + export PDF con membrete.
- **P12 — Config builder + preset Seguros CL:** editores de tipos/campos/reglas/plantillas + playbook precargado.
- **P13 — Add-ons + rollout:** obligaciones/alertas, auditoría, aprobación; QA integral y migración.

Cada fase: `tsc` limpio + pruebas de lógica/DB + (donde aplique) smoke contra la app viva, antes de avanzar.

---

# PARTE D — Sub-decisiones abiertas
1. Librería de PDF server-side (P11): HTML→PDF headless vs `pdf-lib`. *(recomiendo HTML→PDF)*
2. ¿"Caso" multi-documento como unidad (recomendado) vs documento suelto? *(el flujo de seguros exige caso; lo asumo)*.
3. Nombre del producto en UI: "Contract Intelligence" / "Document AI" / "Análisis de Contratos".
4. ¿Los playbooks preset se versionan globalmente (los mantiene DocuIA) y se clonan al org al crear el cliente? *(recomendado)*.
