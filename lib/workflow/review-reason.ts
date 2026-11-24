// Motivo final de por qué una factura quedó en revisión, en una frase corta
// para el lote terminado y la lista de Documentos.

export function reviewReason(input: {
  decisionReason: string | null;
  vendorSelected: boolean;
  lines: Array<{ selected_item_id: string | null }>;
  confidence: number;
  threshold: number;
  neverAutoProcess: boolean;
  /** The client turned automatic sending off: every invoice waits for a person. */
  autoSendOff?: boolean;
}): string {
  const reasons: string[] = [];
  if (input.decisionReason) reasons.push(input.decisionReason);
  if (!input.vendorSelected) reasons.push("Proveedor sin identificar en el ERP");
  const missing = input.lines.filter((l) => !l.selected_item_id).length;
  if (missing > 0) reasons.push(`${missing} línea${missing === 1 ? "" : "s"} sin ítem del ERP`);
  if (input.lines.length === 0) reasons.push("No se leyeron líneas");
  if (input.neverAutoProcess) reasons.push("La regla del proveedor pide revisarla siempre");
  if (reasons.length === 0 && input.confidence < input.threshold) {
    reasons.push(`Lectura con ${Math.round(input.confidence * 100)} % de confianza (pide ${Math.round(input.threshold * 100)} %)`);
  }
  // Last: with something to fix, that is what the reviewer needs to read first.
  if (input.autoSendOff) reasons.push("El envío automático está apagado");
  return reasons.slice(0, 2).join(" · ") || "Revisión pedida por la configuración";
}
