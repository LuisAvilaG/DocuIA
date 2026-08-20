export interface VisualFieldMapping {
  fieldKey: string;
  page: number;
  // Normalised coordinates allow the layout to scale with each uploaded PDF.
  x: number;
  y: number;
  width: number;
  height: number;
  anchorText?: string;
}

export interface VisualTrainingVariant {
  id: string;
  name: string;
  documentType: string;
  signatureText?: string | null;
  mappings: VisualFieldMapping[];
}

// The model receives contextual cues and relative page zones, never a false
// promise of pixel-perfect OCR. It chooses the closest layout and falls back
// to the normal document-wide extraction whenever there is no safe match.
export function visualTrainingPrompt(variants: VisualTrainingVariant[]): string {
  if (variants.length === 0) return "";
  const layouts = variants.slice(0, 8).map((variant) => {
    const fields = variant.mappings.slice(0, 40).map((mapping) =>
      `  - ${mapping.fieldKey}: página ${mapping.page}, zona relativa ${Math.round(mapping.x * 100)}%,${Math.round(mapping.y * 100)}% a ${Math.round((mapping.x + mapping.width) * 100)}%,${Math.round((mapping.y + mapping.height) * 100)}%${mapping.anchorText ? `, texto cercano: "${mapping.anchorText.slice(0, 180)}"` : ""}`,
    ).join("\n");
    return `Plantilla "${variant.name}"${variant.signatureText ? `, texto de referencia: "${variant.signatureText.slice(0, 700)}"` : ""}:\n${fields || "  - sin campos marcados"}`;
  }).join("\n\n");
  return "\n\nGuía visual entrenada por el usuario:\n" +
    "Identifica si el documento se parece a una de estas plantillas usando su composición y texto cercano. " +
    "Si encaja, usa las zonas y anclas como evidencia prioritaria para cada campo. " +
    "Las coordenadas son relativas y solo orientan: no descartes un dato válido por pequeños desplazamientos. " +
    "Si no encaja claramente, realiza la extracción normal de todo el documento.\n" + layouts;
}
