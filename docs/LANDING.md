# Landing pública de DocuIA — estado y decisiones

> Contexto de traspaso (17 jul 2026). La landing fue diseñada por iteración con Luis
> a partir de prototipos animados; este documento resume qué existe, por qué, y qué falta.

## Qué es

Landing de marketing en `/` (antes esa ruta redirigía a `/admin/login`; el acceso admin
quedó como link discreto en el footer). Presenta a DocuIA como **plataforma de documentos
con IA de 3 productos** (AP Automation, Expense Management, Contract Intelligence), con
"tu ERP" como promesa (no "NetSuite": NetSuite es solo el primer conector).

## Archivos

- `app/page.tsx` — metadata SEO y monta el cliente.
- `components/landing/landing-client.tsx` — toda la página (client component, ~700 líneas).
- `components/landing/landing.css` — estilos, todo acotado bajo `.lp`.
- `app/layout.tsx` — carga Plus Jakarta Sans 400/500/600/700.
- Dependencias: `gsap` (ScrollTrigger) + `lenis` (smooth scroll), con cleanup en el useEffect.
- `app/api/v1/contact/route.ts` + `buildDemoRequestEmail` en `lib/email/send.ts` — endpoint
  de contacto listo (zod + rate limit + Resend), **aún sin conectar al formulario**.
- `public/proto/*.html` — prototipos desechables de la fase de diseño. **Borrar antes de deploy.**

## Estructura de la página

1. **Hero**: titular "La contabilidad que se hace sola." + "la máquina": tarjeta que procesa
   en bucle factura → gasto → contrato, cada uno con su destino.
2. **Cómo funciona** (`#como`): 4 pasos con línea que se dibuja al scroll. Copy clave:
   "Modelos de IA que leen. Algoritmos que verifican. Tu equipo decide."
3. **Banda tipográfica**: marquee gigante outline que acelera con la velocidad de scroll.
4. **La plataforma en acción** (`#producto`): simulación animada del producto en 3 escenas
   (~26 s en bucle): cola del dashboard con KPIs y excepción que se resuelve → lienzo de
   flujos de contratos (réplica del builder React Flow real: nodos Entrada/Extracción/
   Validación/Generación) → captura de ticket de gastos (flash de cámara, scan, aprobación).
5. **Productos** (`#productos`): filas editoriales con claim + bullets (sin tarjetas con iconos).
6. **Seguridad y cumplimiento** (`#seguridad`): ficha editorial término + descripción.
   Sin certificaciones (SOC2/ISO) porque no las hay todavía: no inventar.
7. **CTA final** (navy, compacto) + footer con logo real y "Administración" → `/admin/login`.
8. **Modal de contacto**: lo abren todos los CTAs y "Contáctanos" (nav y footer).

## Decisiones de diseño ya tomadas (no reabrir sin Luis)

- Dirección visual: "pipeline vivo" cálido (papel `#FAF7F1`, teal `#12907F`, navy `#0E2647`
  del logo). Se descartaron las direcciones navy-cinematográfica y editorial.
- El producto se muestra con **simulaciones animadas**, no con screenshots.
- Logo real (`/logo-full.png`) recortado por CSS (el PNG trae aire; ver `.logo` en el CSS).
- Un solo CTA por bloque (botón tinta + flecha en cuadro menta). Sin "Ver cómo funciona".
- Bullets con palomita, no chips. Sin recuadros de "destino" en productos.
- Sin frases tipo "Así se ve por dentro" ni "Sin compromiso".
- Copy menciona la tecnología: "modelos multimodales", "motor de reglas determinista".

## Efectos de alto impacto (elegidos por Luis del muestrario, jul 2026)

Aplicados en `landing-client.tsx` (todos con guardas `prefers-reduced-motion` y
`pointer: fine` donde toca el mouse):

- **Preloader orbital**: anillos del logo al cargar, una vez por sesión de pestaña
  (`sessionStorage 'lp-pre'`). Vive fuera de `gsap.context` a propósito (StrictMode).
- **Titular por caracteres**: el H1 se divide en `.ch` en runtime y entra letra a letra.
- **Botones magnéticos**: `.btn-main` (excepto `.send` del modal) atraen el cursor.
- **Tilt 3D**: la tarjeta del hero (`.doc-card`) se inclina siguiendo el mouse.
- **Marquee con skew**: la banda tipográfica se inclina con la velocidad de scroll
  (vía `lenis.velocity`, compuesto con `gsap.set({x})`, no con style.transform directo).
- **Campo de documentos con física**: canvas en el hero (`#heroField`, z-index entre
  la retícula y el contenido); 22 documentos con deriva que huyen del cursor.

Descartados a propósito: hilo conductor pinneado (6), fondo que muta (8), demo
drag-and-drop (9). No los agregues sin preguntar.

## Páginas de producto (jul 2026)

Arquitectura: el home (`/`) es el resumen; cada producto tiene su página de detalle.

- **Contract Intelligence** ya existe: ruta `app/productos/contratos/page.tsx` →
  `components/landing/contract-intelligence-client.tsx`. Reusa `landing.css` (scope `.lp`)
  y el lienzo de flujos (`.fcanvas/.fnode/.fedges`). Secciones: hero con trazabilidad
  animada (campo ↔ cita literal), "cómo funciona" (5 pasos), el constructor de flujo que
  se dibuja al scroll, casos/playbooks, CTA y footer. Modal de contacto propio (→ /api/v1/contact).
- **AP Automation** (`/productos/facturas` → `ap-automation-client.tsx`) y **Expense
  Management** (`/productos/gastos` → `expense-management-client.tsx`) ya existen. Cada una
  con FIRMA VISUAL PROPIA (decisión del usuario: no clonar la landing):
  - Facturas: tarjeta de **cotejo (3-way match)** — líneas que cuadran contra la OC con
    checks + un **duplicado atrapado** (alerta ámbar). Loop.
  - Gastos: **teléfono** que captura el ticket (flash + scan → campos) + **cadena de
    aprobación** (Ana envía → Laura aprueba → registrado en ERP) que se enciende por pasos.
  - Contratos: lienzo de nodos (ya descrito).
  Dropdown, filas del home y footers ahora enlazan a las tres páginas reales.
- Accesos a las páginas: dropdown "Productos" en el nav (hover), la fila del producto en el
  home (clicable, con "Conocer más →"), y la columna Productos del footer.
## Chrome compartido (jul 2026)

El nav, footer y modal de contacto están extraídos en `components/landing/site-chrome.tsx`:
`SiteNav` (dropdown de productos, Planes, Contáctanos), `SiteFooter` (con columna Legal),
`ContactModal` (se abre por evento global: cualquier `[data-contact]` lo dispara vía un
listener delegado) y `SiteMotion` (Lenis + nav sólido + botones magnéticos + reveals, para
páginas sin animación de hero propia como /planes y /legal). Las 4 páginas de producto/home
ya los consumen. IMPORTANTE: las páginas server (planes, legal) deben `import
"@/components/landing/landing.css"` directamente — el import dentro de site-chrome no basta.

## Planes y legales

- `/planes` (`app/planes/page.tsx`): 4 tiers à la carte (Arranque $149, Crecimiento $499
  destacado, Escala $1,199, Enterprise a la medida), precios USD calibrados a LatAm. Son
  PROPUESTA: validar willingness-to-pay antes de fijarlos.
- `/legal/privacidad` y `/legal/terminos`: base en español (LFPDPPP). Tienen PLACEHOLDERS
  ([Razón social], [RFC], [domicilio], [jurisdicción]) y una nota de que requieren completar
  datos de la entidad y revisión jurídica antes de publicar.

## Favicon / OG

`app/icon.png` (ícono orbital recortado) reemplaza el favicon default. `app/opengraph-image.png`
y `app/twitter-image.png` (1200x630, generados con sharp). `metadataBase` en el layout raíz.

## Pendientes

1. Producción necesita `CONTACT_EMAIL` y `RESEND_API_KEY` para que el formulario
   (ya conectado a `POST /api/v1/contact`) entregue el correo.
2. Borrar `public/demos.html` (muestrario desechable) antes del deploy.
3. Futuro discutido: páginas de producto individuales (`/facturas`, `/gastos`, `/contratos`)
   usando el tratamiento del pipeline vivo por producto.

## Cómo correr

`npm run dev` (la landing no necesita Postgres; la DB solo hace ruido en logs si está apagada).
