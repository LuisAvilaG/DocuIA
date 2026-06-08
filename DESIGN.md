---
name: DocuIA
description: Plataforma de procesamiento inteligente de documentos fiscales con IA e integración NetSuite
colors:
  warm-canvas: "oklch(0.975 0.006 75)"
  paper-surface: "oklch(0.992 0.003 75)"
  paper-muted: "oklch(0.93 0.008 75)"
  indigo-studio: "oklch(0.45 0.18 265)"
  indigo-studio-hover: "oklch(0.40 0.18 265)"
  indigo-studio-subtle: "oklch(0.95 0.03 265)"
  deep-void: "oklch(0.18 0.015 258)"
  charcoal-mid: "oklch(0.52 0.02 258)"
  ghost-line: "oklch(0.88 0.01 75)"
  confirmed-green: "oklch(0.55 0.15 160)"
  confirmed-green-subtle: "oklch(0.95 0.04 160)"
  review-amber: "oklch(0.62 0.16 85)"
  review-amber-subtle: "oklch(0.96 0.04 85)"
  error-crimson: "oklch(0.50 0.20 25)"
  error-crimson-subtle: "oklch(0.96 0.04 25)"
typography:
  display:
    fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  title:
    fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.01em"
  body:
    fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.06em"
rounded:
  sm: "6px"
  md: "8px"
  lg: "12px"
  xl: "16px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.indigo-studio}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "10px 20px"
  button-primary-hover:
    backgroundColor: "{colors.indigo-studio-hover}"
    textColor: "#ffffff"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.charcoal-mid}"
    rounded: "{rounded.md}"
    padding: "10px 20px"
  button-ghost-hover:
    backgroundColor: "{colors.paper-muted}"
    textColor: "{colors.deep-void}"
  input-default:
    backgroundColor: "{colors.paper-surface}"
    textColor: "{colors.deep-void}"
    rounded: "{rounded.md}"
    padding: "9px 12px"
  input-focus:
    backgroundColor: "{colors.paper-surface}"
    textColor: "{colors.deep-void}"
  card-default:
    backgroundColor: "{colors.paper-surface}"
    rounded: "{rounded.lg}"
    padding: "16px"
  badge-success:
    backgroundColor: "{colors.confirmed-green-subtle}"
    textColor: "{colors.confirmed-green}"
    rounded: "{rounded.sm}"
    padding: "3px 8px"
  badge-warning:
    backgroundColor: "{colors.review-amber-subtle}"
    textColor: "{colors.review-amber}"
    rounded: "{rounded.sm}"
    padding: "3px 8px"
  badge-error:
    backgroundColor: "{colors.error-crimson-subtle}"
    textColor: "{colors.error-crimson}"
    rounded: "{rounded.sm}"
    padding: "3px 8px"
---

# Design System: DocuIA

## 1. Overview

**Creative North Star: "El Despacho Digital"**

DocuIA es el espacio de trabajo donde la contabilidad se vuelve fluida. Piensa en una oficina bien organizada: superficies claras y neutras que no compiten con el trabajo en sí, un solo color de acento que señala acción sin gritar, tipografía que comunica competencia sin pretensión. La plataforma procesa el caos fiscal — facturas, órdenes de compra, CFDIs — y lo convierte en orden. La UI refleja ese resultado: calma después del proceso.

El sistema rechaza tres arquetipos de diseño: las herramientas contables tradicionales (SAP GUI, CONTPAQi) que tratan cada pantalla como un formulario a sobrevivir; los dashboards oscuros genéricos que confunden estética con funcionalidad; y las interfaces corporativas frías que hacen sentir al usuario como un número. El Despacho Digital es luminoso, organizado, y discretamente profesional — cálido sin ser informal.

El tema es estrictamente claro. Las superficies son papel cálido, no blanco de hospital ni gris de hoja de cálculo. La paleta total cabe en una tarjeta de visita.

**Key Characteristics:**
- Fondo lienzo cálido con leve tinte cálido — nunca blanco frío, nunca oscuro
- Un único acento cromático: índigo profundo, usado con parsimonia
- Tipografía humanista (Plus Jakarta Sans) legible a 11px en tablas de alta densidad
- Sistema semántico de tres colores para estados de documento: verde / ámbar / carmesí
- Densidad de información media-alta sin sensación de saturación

## 2. Colors: La Paleta del Despacho

Paleta restringida: neutrales cálidos como base, índigo profundo como única voz de acción, semánticos reservados para estados de datos.

### Primary

- **Índigo Estudio** (`oklch(0.45 0.18 265)`): El único acento de la interfaz. Aparece en botones de acción principal, ítem de nav activo, focus rings, y vínculos. Solo cuando hay acción o estado activo — nunca decorativo.
- **Índigo Estudio Sutil** (`oklch(0.95 0.03 265)`): Background del nav activo, hover de filas de tabla con selección, chips de filtro activos. El "eco" del acento sin su peso.
- **Índigo Estudio Hover** (`oklch(0.40 0.18 265)`): Estado hover del botón primary. Más oscuro, mismo hue.

### Neutral

- **Lienzo Cálido** (`oklch(0.975 0.006 75)`): Background principal de la aplicación. Levemente tostado — ni frío ni amarillo. El piso sobre el que todo lo demás vive.
- **Superficie Papel** (`oklch(0.992 0.003 75)`): Cards, inputs, sidebar, modals. El "papel" sobre el que se trabaja.
- **Papel Apagado** (`oklch(0.93 0.008 75)`): Hover de ghost buttons, backgrounds de secciones secundarias, tabla de filas alternas.
- **Carbón Profundo** (`oklch(0.18 0.015 258)`): Texto primario, headings, valores de KPI. Con leve tinte índigo — nunca negro puro.
- **Pizarrón Medio** (`oklch(0.52 0.02 258)`): Texto secundario, labels de columna, metadatos, placeholders activos.
- **Línea Fantasma** (`oklch(0.88 0.01 75)`): Bordes de cards, inputs, dividers de tabla. Cálida y sutil — visible sin competir.

### Semantic

- **Verde Confirmado** (`oklch(0.55 0.15 160)`): Estado completado, éxito, mapeo confirmado. Siempre sobre su background sutil (`oklch(0.95 0.04 160)`).
- **Ámbar Revisión** (`oklch(0.62 0.16 85)`): Excepciones pendientes, documentos en revisión, advertencias. Siempre sobre su sutil (`oklch(0.96 0.04 85)`).
- **Carmesí Error** (`oklch(0.50 0.20 25)`): Fallos de procesamiento, errores críticos, acciones destructivas. Siempre sobre su sutil (`oklch(0.96 0.04 25)`).

**The Índigo Único Rule.** El acento índigo aparece en ≤15% de cualquier pantalla. Su escasez es su poder. Si todo es índigo, nada es índigo.

**The Warm-Only Rule.** Ningún neutral tiene chroma 0. Todo neutral lleva entre 0.006 y 0.02 de chroma: cálido (hue ~75°) para fondos y bordes, frío-índigo (hue ~258°) para texto. Los grises puros hacen sentir el sistema como una hoja de cálculo.

**The Semantic Containment Rule.** Verde, ámbar y carmesí son exclusivos de estados de datos. Nunca usarlos para decoración, categorización arbitraria, o como acento alternativo al índigo.

## 3. Typography: Plus Jakarta Sans

**Fuente única:** Plus Jakarta Sans (Google Fonts, subconjunto latin). Cargar vía `next/font/google` en el root layout. Un solo `@font-face` — pesos 400, 500, 600.

**Carácter:** Geométrica con corazón humanista. Precisa sin frialdad, legible a 11px en labels de tabla, con suficiente personalidad para distinguirse del stack de Inter/Space Grotesk que domina el espacio de herramientas IA. El tipo no llama la atención — facilita la lectura.

### Hierarchy

- **Display** (600, 1.5rem, 1.25, -0.02em): Valores grandes en stat cards (KPIs). Raramente fuera de ese contexto.
- **Title** (600, 0.875rem, 1.4, -0.01em): Headers de sección, nombres en tablas, títulos de card. El escalón más frecuente.
- **Body** (400, 0.875rem, 1.6): Texto de párrafo, descripciones, contenido de celdas con texto largo. Máximo 70ch de ancho.
- **Label** (500, 0.6875rem, 1.4, 0.06em, UPPERCASE): Headers de columna de tabla, category labels, sección labels en sidebar. Nunca más de 3 palabras en mayúsculas.

**The Single Family Rule.** Solo Plus Jakarta Sans. La jerarquía viene de peso, tamaño y color — no de mezclar familias tipográficas. Cero excepciones para monospace, cero excepciones para serif.

**The Tabular Rule.** Toda columna numérica (totales, fechas, IDs, conteos) usa `font-variant-numeric: tabular-nums`. Los números que no están alineados en columnas no son datos — son texto.

## 4. Elevation

El sistema usa elevación tonal como mecanismo primario: la profundidad se percibe a través del contraste entre el lienzo cálido (background `0.975`) y la superficie papel (cards `0.992`). Esta diferencia sutil — apenas 1.7 puntos de lightness — es suficiente en un tema claro.

Las sombras existen solo para elementos que literalmente flotan sobre el canvas: menús contextuales, modals, tooltips, dropdowns. Cards y paneles en el layout principal son tonal, sin sombra.

### Shadow Vocabulary

- **ambient-float** (`0 4px 16px oklch(0.18 0.015 258 / 0.08), 0 1px 4px oklch(0.18 0.015 258 / 0.04)`): Para cards con interacción importante o modales de segundo nivel. Difuso, muy sutil.
- **popover-lift** (`0 8px 32px oklch(0.18 0.015 258 / 0.12), 0 2px 8px oklch(0.18 0.015 258 / 0.06)`): Dropdowns, select menus, popovers, tooltips.
- **modal-high** (`0 20px 60px oklch(0.18 0.015 258 / 0.15), 0 4px 16px oklch(0.18 0.015 258 / 0.08)`): Modals, sheets, drawers de detalle.

**The Flat-By-Default Rule.** Las surfaces en reposo son planas. Las sombras aparecen solo en elementos que flotan sobre el canvas. Una card en el layout del dashboard es tonal, no elevada.

## 5. Components

### Buttons

Curvados suavemente (8px radius). No píldora, no cuadrado.

- **Primary:** Background índigo estudio, texto blanco, padding 10px 20px. Sombra sutil `0 1px 3px oklch(0.45 0.18 265 / 0.3)` para darle peso sin dramatismo.
- **Hover:** `oklch(0.40 0.18 265)`, `translateY(-1px)`, sombra ligeramente amplificada.
- **Focus visible:** Ring 2px offset índigo estudio. Nunca outline nativo del navegador.
- **Ghost:** Background transparente, texto pizarrón medio. Hover: fondo papel apagado, texto carbón profundo.
- **Destructive:** Reservado para confirmaciones de eliminación. Background carmesí error. No aparece en el flujo normal.

### Inputs / Fields

- **Default:** Superficie papel, borde línea fantasma (1px), radius 8px, padding 9px 12px, texto carbón profundo.
- **Focus:** Borde 1.5px índigo estudio, ring `0 0 0 3px oklch(0.45 0.18 265 / 0.12)`.
- **Error:** Borde carmesí error, ring carmesí sutil.
- **Placeholder:** Pizarrón medio al 50% de opacidad.
- **Disabled:** Fondo papel apagado, texto pizarrón medio al 40%, sin pointer events.

### Cards / Containers

- **Corner Style:** Gently curved (12px). Siente el contenedor sin asfixiarlo.
- **Background:** Superficie papel.
- **Shadow:** Ninguna en reposo. `ambient-float` solo en hover de cards interactivas.
- **Border:** 1px línea fantasma. El borde es siempre visible — la separación tonal sola no es suficiente en pantallas de alta densidad.
- **Padding:** 16px por defecto. 24px en cards con contenido editorial. 0 en cards que contienen una tabla (la tabla maneja su propio padding interno).

### Status Badges

Chips pequeños de estado del documento. Siempre semantic color suave sobre background sutil del mismo tono. Radius 6px, padding 3px 8px, label weight (500, 0.6875rem).

- **Completado:** texto verde confirmado sobre verde sutil
- **Revisión / Pendiente / En proceso:** texto ámbar revisión sobre ámbar sutil
- **Error / Fallido:** texto carmesí sobre carmesí sutil
- **Neutral (subido, etc.):** texto pizarrón medio sobre papel apagado

Nunca usar fondos de color sólido saturado para badges de estado. El fondo sutil es obligatorio.

### Navigation (Sidebar)

- **Background:** Superficie papel, borde derecho línea fantasma (1px).
- **Item default:** Texto pizarrón medio, sin background, radius 8px, padding 8px 10px.
- **Item hover:** Fondo papel apagado, texto carbón profundo.
- **Item active:** Fondo índigo sutil, texto índigo estudio, borde izquierdo `2px solid oklch(0.45 0.18 265)`.
- **Section labels:** Label style (0.6875rem, uppercase, 0.06em tracking), pizarrón medio al 60%.
- **Logo container:** Fondo superficie papel, borde inferior línea fantasma.

### Stat Card (Componente Signature)

El KPI card es el componente más visible del dashboard. Su forma define el carácter visual de la app.

- Superficie papel, borde color-coded al semantic color del dato (ej. borde `oklch(0.55 0.15 160 / 0.3)` para docs completados).
- Valor principal en display (600, 1.5rem, tracking -0.02em).
- Label en label style (uppercase, 0.6875rem, tracking 0.06em), pizarrón medio.
- Ícono en contenedor 28×28px, radius 8px, background sutil del semantic color.
- Subtítulo en body (0.6875rem), pizarrón medio.
- Sin gradientes. Sin métricas grandes con color de relleno detrás. El número es el protagonista.

## 6. Do's and Don'ts

### Do:

- **Do** usar lienzo cálido (`oklch(0.975 0.006 75)`) como background principal de la app — nunca blanco frío, nunca oscuro.
- **Do** reservar el índigo estudio para acciones y estados activos únicamente. Máximo 15% de superficie por pantalla.
- **Do** usar `font-variant-numeric: tabular-nums` en todas las columnas numéricas — totales, fechas, IDs, conteos.
- **Do** mostrar el estado de cada documento con el sistema semántico verde/ámbar/carmesí en su versión badge (sutil).
- **Do** mantener bordes visibles en tablas y cards — la separación tonal por sí sola no es suficiente en densidad alta.
- **Do** cargar Plus Jakarta Sans vía `next/font/google` en el root layout con subconjunto latin y pesos 400/500/600.
- **Do** usar jerarquía tipográfica (peso + tamaño) para comunicar importancia — no color de texto.

### Don't:

- **Don't** usar fondos oscuros ni dark mode. Este sistema es estrictamente tema claro. Ningún componente tiene variante oscura.
- **Don't** imitar herramientas contables tradicionales (SAP GUI, CONTPAQi): layouts de filas apretadas sin jerarquía, botones grises, tables sin respiración.
- **Don't** usar dashboards oscuros genéricos — la paleta completa colapsaría. El warm-canvas es la base inamovible.
- **Don't** usar más de un color de acento decorativamente. Esmeralda, ámbar y carmesí son exclusivos de estados semánticos — nunca usados como "segundo acento".
- **Don't** usar `border-left` grueso (>1px) como stripe de color decorativo en cards, alertas, o list items. El estado se comunica con badges semánticos o con el borde completo de la card.
- **Don't** aplicar `background-clip: text` con gradiente. Todo texto es un color sólido.
- **Don't** usar la plantilla "número grande + gradiente de acento" en KPIs. Los stat cards tienen su propio sistema.
- **Don't** mezclar familias tipográficas. Solo Plus Jakarta Sans en todos los contextos.
- **Don't** usar grises puros (chroma 0) en ningún neutral — el sistema se siente frío y genérico.
