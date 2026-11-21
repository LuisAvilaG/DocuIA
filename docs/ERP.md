# ERP: cómo se conecta DocuIA y cómo agregar otro

DocuIA habla con el ERP de cada cliente a través de un **adaptador**. Hoy existe uno,
NetSuite. El resto de la aplicación no sabe qué ERP hay del otro lado: pide el adaptador
del cliente y le hace las mismas preguntas a cualquiera.

## Piezas

| Pieza | Qué es |
|---|---|
| `lib/erp/types.ts` | El contrato: `ErpAdapter`, sus datos y `ErpCapabilities`. |
| `lib/erp/index.ts` | El registro `ERP_PROVIDERS` y `getErp(orgId)`, que devuelve el adaptador del cliente. |
| `lib/erp/netsuite.ts` | El adaptador de NetSuite. |
| `ns_connections.provider` | Qué ERP usa cada conexión (`netsuite` por defecto). |
| `ns_connections.provider_config` | Credenciales de un ERP que no sea NetSuite, como JSON cifrado. |

## Qué le pide DocuIA a un ERP

- **Probar la conexión** (`testConnection`) y listar las **unidades de la empresa** (`listCompanyUnits`: subsidiarias en NetSuite, sociedades en SAP).
- **Catálogos** por unidad, por páginas (`fetchCatalogPage`): ítems, proveedores y ubicaciones.
- **Órdenes de compra**: las abiertas de un proveedor (`fetchOpenPurchaseOrders`) y sus líneas con lo recibido y lo facturado (`fetchPurchaseOrderLines`).
- **Enviar un documento** (`postDocument`): factura de proveedor u orden de compra, con validación sin guardar (`dry_run`).
- **Enlace al registro** ya creado (`recordUrl`).
- **Gastos** (`expenses`, opcional): leer categorías, departamentos, clases y empleados, y enviar un informe aprobado.

`ErpCapabilities` dice qué de eso sabe hacer cada ERP. Los flujos consultan ahí antes de usar
algo (por ejemplo, sin `purchaseOrders` el cotejo contra la OC responde que el ERP no lo permite).

## Agregar un ERP

1. Agregar su id a `ERP_PROVIDER_IDS` en `lib/erp/types.ts`.
2. Escribir `lib/erp/<erp>.ts` con una función que reciba la conexión y devuelva un `ErpAdapter`.
   Sus credenciales se leen de `provider_config` (cifrado con `lib/crypto/encrypt.ts`).
3. Registrarlo en `ERP_PROVIDERS` (`lib/erp/index.ts`) con su nombre y sus capacidades.
4. Guardar la conexión del cliente con `provider` = ese id.

Los datos que devuelve un adaptador (ítems, proveedores, OC) usan las formas de `lib/erp/types.ts`;
el adaptador convierte los registros de su ERP a esas formas.

## Lo que todavía es de NetSuite

Pasar por el adaptador no basta para tener un segundo ERP funcionando. Esto sigue hecho a la
medida de NetSuite y habrá que generalizarlo al construir el siguiente adaptador:

- **Alta de la conexión** (`app/api/admin/clients/[id]/connection`, pantalla ERP del superadmin y
  asistente de alta): piden las cinco credenciales de NetSuite y los ids de sus dos scripts.
  Falta un formulario por proveedor.
- **Gastos**: el adaptador de NetSuite delega en `lib/expense/sync-to-netsuite.ts` y
  `lib/expense/sync-catalogs.ts`, que mezclan las consultas a NetSuite con la escritura en la
  base. Otro ERP necesita su propia versión de esas dos piezas.
- **Forma del envío**: `lib/workflow/ns-payload.ts` arma la solicitud con campos pensados para el
  script de NetSuite (ids internos, `po_line`, formulario personalizado, adjuntos al File Cabinet).
  El adaptador nuevo tendrá que traducir esos campos.
- **Dos entornos por cliente** (sandbox y producción, `organizations.active_ns_environment`): modo QA,
  envío de prueba y la relectura de catálogos al cambiar de entorno lo dan por hecho.
- **Subsidiaria** como unidad de todo: catálogos, mapeos y documentos cuelgan de `subsidiaries`.
- **Nombres**: columnas `netsuite_*` / `ns_*` y las features `netsuite_dry_run` y
  `custom_netsuite_forms`. Solo son nombres; no cambian el comportamiento.
- **Campos propios de un cliente** en el catálogo de ítems (`drt_unit_*`) y el filtro de
  categoría de servicio para subsidiarias en MXN.
