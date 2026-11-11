// Filas de contract_validations con su evidencia. Si el documento está indexado
// por páginas (Archivo o localizador), se guarda también la página de cada cita;
// la posición exacta la calcula el visor sobre el PDF.
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { contractArchiveDocuments, contractArchivePages } from "@/db/schema";
import { findQuotePage, type EvidenceRef } from "./evidence";
import type { ValidationResult } from "./validate";

export async function attachEvidencePages(validations: ValidationResult[], caseDocumentIds: string[]): Promise<void> {
  const pending = validations.flatMap((v) => (v.evidence ?? []).filter((e) => e.page === null));
  if (pending.length === 0 || caseDocumentIds.length === 0) return;
  const archived = await db.query.contractArchiveDocuments.findMany({
    where: inArray(contractArchiveDocuments.caseDocumentId, caseDocumentIds),
    columns: { id: true, caseDocumentId: true },
  });
  if (archived.length === 0) return;
  const pages = await db.query.contractArchivePages.findMany({
    where: inArray(contractArchivePages.documentId, archived.map((a) => a.id)),
    columns: { documentId: true, pageNumber: true, text: true },
  });
  const byCaseDoc = new Map<string, Array<{ pageNumber: number; text: string }>>();
  for (const a of archived) if (a.caseDocumentId) byCaseDoc.set(a.caseDocumentId, pages.filter((p) => p.documentId === a.id));
  for (const ev of pending) locate(ev, byCaseDoc);
}

function locate(ev: EvidenceRef, byCaseDoc: Map<string, Array<{ pageNumber: number; text: string }>>) {
  const candidates = ev.documentId ? [ev.documentId] : [...byCaseDoc.keys()];
  for (const id of candidates) {
    const pages = byCaseDoc.get(id);
    if (!pages?.length) continue;
    const page = findQuotePage(pages, ev.quote);
    if (page !== null) { ev.page = page; ev.documentId = id; return; }
  }
}

export async function validationRows(caseId: string, validations: ValidationResult[], caseDocumentIds: string[]) {
  await attachEvidencePages(validations, caseDocumentIds).catch((error) => console.warn("[contracts] no se pudo ubicar la evidencia", error instanceof Error ? error.message : error));
  return validations.map((v) => ({
    caseId,
    ruleName: v.ruleName,
    severity: v.severity,
    subject: v.subject,
    status: v.status,
    ok: v.ok,
    reason: v.reason,
    checksJson: v.checks,
    citation: v.citation,
    evidenceJson: v.evidence?.length ? v.evidence : null,
  }));
}
