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

## Pendientes

1. **Conectar el formulario del modal a `POST /api/v1/contact`** (hoy simula el envío;
   está marcado con comentario en `landing-client.tsx`). Producción necesita
   `CONTACT_EMAIL` y `RESEND_API_KEY` (fallback en código: `ventas@docuia.com`).
2. Borrar `public/proto/` antes del deploy.
3. Commit inicial de todo esto (nada está commiteado).
4. Futuro discutido: páginas de producto individuales (`/facturas`, `/gastos`, `/contratos`)
   usando el tratamiento del pipeline vivo por producto.

## Cómo correr

`npm run dev` (la landing no necesita Postgres; la DB solo hace ruido en logs si está apagada).
