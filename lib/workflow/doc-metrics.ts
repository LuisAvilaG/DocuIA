// Datos de métricas por factura (history_documents.metrics_json). Columna
// aparte de products porque al enviar al ERP products se reemplaza por las
// líneas enviadas.
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { historyDocuments } from "@/db/schema";

export interface DocMetrics {
  /** Campos corregidos en la revisión, con cuántas veces. */
  corrections?: { fields: Record<string, number>; at: string; by: string | null };
  /** Líneas leídas, con ítem asignado al leer y de esas cuántas por la memoria de mapeos. */
  mapping?: { lines: number; assigned: number; fromMemory: number };
  /** Factura detectada como duplicada: de cuál y por cuánto. */
  duplicate?: { of: number; amount: number | null; currency: string | null; at: string };
  /** Diferencia con la OC al enviar y cómo se aceptó. */
  po?: {
    poId: string; invoiceTotal: number; poTotal: number; difference: number; differencePct: number;
    withinTolerance: boolean; linesWithinTolerance: number; outcome: string;
    accepted: "match" | "tolerance" | "approval"; by: string | null; at: string;
  };
}

/** Une datos nuevos a los que ya tiene el documento. */
export async function mergeDocMetrics(docId: number, patch: DocMetrics): Promise<void> {
  await db.update(historyDocuments)
    .set({ metricsJson: sql`coalesce(${historyDocuments.metricsJson}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb` })
    .where(eq(historyDocuments.id, docId));
}

/** Cómo se aceptó la diferencia con la OC. */
export function poAcceptance(cmp: { totalDifference: number; counts: Record<string, number> }, outcomeKind: string): "match" | "tolerance" | "approval" {
  if (outcomeKind === "needs_approval" || outcomeKind === "blocked") return "approval";
  if (Math.abs(cmp.totalDifference) > 0.005 || (cmp.counts.price_within_tolerance ?? 0) > 0) return "tolerance";
  return "match";
}
