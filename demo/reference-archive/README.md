# Demo: rastreo de correspondencia y PDFs extensos

Los tres `.txt` son **ficticios**. No representan documentos de Metro de Lima ni del cliente; sirven para verificar la secuencia antes de usar su expediente real.

## Preparación (administrador del tenant)

1. Desplegar esta versión y comprobar que estén activos `Archivo y rastreo de referencias` y `Documentos extensos en casos`.
2. Ir a **Flujos** → **Crear flujo de demo**. Revisar las notas y activar el borrador.
3. Ir a **Archivo** y cargar `01-CARTA-001-2026.txt`. Esperar a que diga **Listo**.
4. Cargar `02-INFORME-003-2026.txt`. Debe enlazar `CARTA-001-2026`.
5. En **Casos**, elegir **Demo · Rastreo de correspondencia** y subir `03-CARTA-015-2026.txt`.

## Recorrido para el cliente (2–3 minutos)

- “Esta carta cita comunicaciones anteriores. Antes debían copiar cada código y buscarlo a mano.”
- Abrir el caso: mostrar extracción del código y asunto, y la validación **Origen y pertinencia de referencias**.
- Abrir **Archivo** → `CARTA-015-2026`: enseñar el fragmento y la página donde cita `INFORME-003-2026` y `CARTA-001-2026`, abrir los documentos origen y explicar la evaluación de pertinencia. `CARTA-099-2026` aparece como **Sin localizar**, sin inventar un origen.
- “Si hay dos documentos con el mismo código, una lectura dudosa o una referencia faltante, un usuario la corrige o confirma; esa decisión queda registrada.”
- Tras revisar/aprobar el caso, generar el informe de trazabilidad en PDF.

## PDF grande

Para la segunda parte use un **PDF real proporcionado por el cliente** (no estos archivos de texto), de hasta 150 MB. Súbalo a un caso con un flujo que extraiga campos concretos del contrato. Muestre el porcentaje de carga y, dentro del caso, el avance de páginas. Explique: “El archivo se carga por partes; DocuIA lee páginas y envía a la IA solo secciones pertinentes a los campos configurados. Las páginas sin texto digital pasan por OCR.” No prometa tiempos fijos ni exactitud perfecta en escaneos de mala calidad.

## Qué no afirmar

- La pertinencia automática es apoyo a la revisión, no un dictamen jurídico definitivo.
- El código detectado puede corregirse y los formatos no reconocidos pueden añadirse manualmente con su página y contexto.
- La demo ficticia no prueba acceso a SharePoint ni File Server: esas integraciones requieren análisis y configuración aparte.
