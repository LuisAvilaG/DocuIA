// Modo QA en el envío al ERP: mientras está vigente, cada documento se crea en el
// ERP aunque ya exista, con otro id externo y un número adicional, y sigue su
// camino normal. Cada envío queda en `history_documents.qa_sends`.
import { db } from "@/lib/db";
import { historyDocuments } from "@/db/schema";
import { eq } from "drizzle-orm";
import { qaModeState } from "@/lib/features/qa-mode-state";
import { qaDocumentNumber, type QaConfig } from "@/lib/features/qa-mode";

export interface QaSend {
  at: string;
  by: string | null;
  seq: number;
  externalId: string;
  documentNumber: string;
  internalId: string | null;
  recordUrl: string | null;
  /** Documento que ya existía con el mismo número; se aceptó por el modo QA. */
  duplicateOf: number | null;
}

export interface QaPlan {
  seq: number;
  externalId: string;
  documentNumber: string;
  memo: string;
}

export function qaSendsOf(value: unknown): QaSend[] {
  return Array.isArray(value) ? (value as QaSend[]) : [];
}

/** Si el modo QA aplica a este tipo de documento. */
export function qaAppliesTo(config: Pick<QaConfig, "applies_to">, documentType: string): boolean {
  return documentType !== "purchase_order" || config.applies_to === "invoices_and_po";
}

/** Id externo, número y nota del siguiente envío QA de un documento (puro). */
export function buildQaPlan(opts: {
  config: Pick<QaConfig, "number_suffix">;
  orgId: string;
  docId: number;
  previous: number;
  baseNumber: string | null;
  now?: Date;
}): QaPlan {
  const seq = opts.previous + 1;
  const stamp = (opts.now ?? new Date()).getTime().toString(36);
  const base = opts.baseNumber?.trim() || `DOC${opts.docId}`;
  return {
    seq,
    externalId: `docuia-qa:${opts.orgId}:${opts.docId}:${seq}-${stamp}`,
    documentNumber: qaDocumentNumber(base, opts.config.number_suffix, seq).slice(0, 45),
    memo: `Modo QA DocuIA · envío ${seq} del documento ${opts.docId}`,
  };
}

/** Plan del envío QA si el modo está vigente para la organización y el tipo de documento. */
export async function qaPlanFor(orgId: string, doc: { id: number; documentType: string; qaSends: unknown }, baseNumber: string | null): Promise<QaPlan | null> {
  const state = await qaModeState(orgId).catch(() => null);
  if (!state?.active || !state.config || !qaAppliesTo(state.config, doc.documentType)) return null;
  return buildQaPlan({ config: state.config, orgId, docId: doc.id, previous: qaSendsOf(doc.qaSends).length, baseNumber });
}

/** Guarda el envío QA en el documento y lo marca como de una ronda de pruebas. */
export async function recordQaSend(docId: number, plan: QaPlan, result: { internalId: string | null; recordUrl: string | null }, by: string | null, duplicateOf: number | null = null): Promise<void> {
  const row = await db.query.historyDocuments.findFirst({ where: eq(historyDocuments.id, docId), columns: { qaSends: true } });
  const entry: QaSend = {
    at: new Date().toISOString(), by, seq: plan.seq, externalId: plan.externalId, documentNumber: plan.documentNumber,
    internalId: result.internalId, recordUrl: result.recordUrl, duplicateOf,
  };
  await db.update(historyDocuments)
    .set({ isQa: true, qaSends: [...qaSendsOf(row?.qaSends), entry] as unknown })
    .where(eq(historyDocuments.id, docId));
}
