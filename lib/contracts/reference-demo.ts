import type { FlowGraph } from "./flow";

/** A reusable, disabled-by-default demo flow; no tenant is changed until an admin creates it. */
export function referenceDemoGraph(): FlowGraph {
  return {
    nodes: [
      { id: "demo_intake", kind: "intake", position: { x: 80, y: 120 }, data: { docTypeKey: "correspondencia", name: "Carta o transmittal", hint: "Comunicación que cita otra carta, informe u oficio" } },
      { id: "demo_extract", kind: "extract", position: { x: 350, y: 120 }, data: { docTypeKey: "correspondencia", fields: [
        { fieldKey: "codigo", label: "Código propio de la carta", isList: false },
        { fieldKey: "fecha", label: "Fecha de emisión", isList: false },
        { fieldKey: "asunto", label: "Asunto o tema principal", isList: false },
        { fieldKey: "remitente", label: "Remitente", isList: false },
        { fieldKey: "destinatario", label: "Destinatario", isList: false },
        { fieldKey: "referencias", label: "Códigos de documentos citados", isList: true },
        { fieldKey: "solicitud", label: "Solicitud o conclusión de la comunicación", isList: false },
      ] } },
      { id: "demo_lookup", kind: "reference_lookup", position: { x: 640, y: 120 }, data: { name: "Origen y pertinencia de referencias", severity: "warn" } },
      { id: "demo_generate", kind: "generate", position: { x: 940, y: 120 }, data: { templateKey: "informe_referencias", name: "Informe de trazabilidad", body: [
        "INFORME DE TRAZABILIDAD DOCUMENTAL", "", "Documento: {{codigo}}", "Fecha: {{fecha}}", "Asunto: {{asunto}}", "Remitente: {{remitente}}", "Destinatario: {{destinatario}}", "", "Referencias citadas:", "{{referencias}}", "", "Hallazgos de rastreo y pertinencia:", "{{_validations}}", "", "Solicitud o conclusión: {{solicitud}}", "", "Este resultado requiere revisión humana antes de utilizarse como evidencia oficial.",
      ].join("\n"), source: "editor" } },
      { id: "demo_note_1", kind: "note", position: { x: 80, y: 300 }, width: 245, height: 150, data: { body: "1. Primero carga al Archivo una carta de origen. El sistema extrae su código y la deja localizable para comunicaciones futuras." } },
      { id: "demo_note_2", kind: "note", position: { x: 375, y: 300 }, width: 245, height: 150, data: { body: "2. En Casos sube la carta nueva. La IA extrae datos de cabecera; el rastreo no depende de que la IA recuerde todo el archivo." } },
      { id: "demo_note_3", kind: "note", position: { x: 670, y: 300 }, width: 245, height: 150, data: { body: "3. El motor identifica códigos, busca los documentos origen y evalúa si el asunto realmente corresponde. Faltantes y dudas quedan para revisión." } },
      { id: "demo_note_4", kind: "note", position: { x: 965, y: 300 }, width: 245, height: 150, data: { body: "4. Tras la aprobación del caso, genera un informe PDF con los hallazgos. Nunca presentes la evaluación automática como certeza jurídica." } },
    ],
    edges: [
      { id: "e_demo_1", source: "demo_intake", target: "demo_extract" },
      { id: "e_demo_2", source: "demo_extract", target: "demo_lookup" },
      { id: "e_demo_3", source: "demo_lookup", target: "demo_generate" },
    ],
  };
}
