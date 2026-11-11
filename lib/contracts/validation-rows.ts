// Filas de contract_validations con su evidencia. Si el documento está indexado
// por páginas (Archivo o localizador), se guarda la página de cada cita. En
// páginas escaneadas se guarda también la posición (OCR de esa página); en las
// digitales la posición la calcula el visor sobre la capa de texto del PDF.
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { contractArchiveDocuments, contractArchivePages, contractDocuments, contractValidations } from "@/db/schema";
import { findQuotePage, matchQuote, type Box, type EvidenceRef, type WordBox } from "./evidence";
import { ocrPageWords } from "./ocr-boxes";
import type { ValidationResult } from "./validate";

/** Páginas escaneadas que se pasan por OCR para ubicar evidencia, por caso. */
const MAX_OCR_PAGES = 12;

type PageText = { pageNumber: number; text: string; ocrMode: string };

const evidenceKey = (ev: Pick<EvidenceRef, "documentId" | "page" | "quote">) => `${ev.documentId}:${ev.page}:${ev.quote}`;

/** Posiciones ya calculadas para el caso (evidence_json de sus validaciones guardadas). */
async function knownBoxes(caseId: string): Promise<Map<string, Box>> {
  const rows = await db.select({ evidence: contractValidations.evidenceJson }).from(contractValidations).where(eq(contractValidations.caseId, caseId));
  const out = new Map<string, Box>();
  for (const row of rows) {
    for (const ev of (Array.isArray(row.evidence) ? row.evidence : []) as EvidenceRef[]) {
      if (ev?.box && ev.documentId && ev.page && typeof ev.quote === "string") out.set(evidenceKey(ev), ev.box);
    }
  }
  return out;
}

export async function attachEvidencePages(validations: ValidationResult[], caseDocumentIds: string[], ocr = ocrPageWords, known: Map<string, Box> = new Map()): Promise<void> {
  const evidence = validations.flatMap((v) => (v.ok === true ? [] : v.evidence ?? []));
  if (evidence.length === 0 || caseDocumentIds.length === 0) return;
  const archived = await db.query.contractArchiveDocuments.findMany({
    where: inArray(contractArchiveDocuments.caseDocumentId, caseDocumentIds),
    columns: { id: true, caseDocumentId: true },
  });
  if (archived.length === 0) return;
  const pages = await db.query.contractArchivePages.findMany({
    where: inArray(contractArchivePages.documentId, archived.map((a) => a.id)),
    columns: { documentId: true, pageNumber: true, text: true, ocrMode: true },
  });
  const byCaseDoc = new Map<string, PageText[]>();
  for (const a of archived) if (a.caseDocumentId) byCaseDoc.set(a.caseDocumentId, pages.filter((p) => p.documentId === a.id));
  for (const ev of evidence) if (ev.page === null) locate(ev, byCaseDoc);

  // Posición en páginas escaneadas: el visor no tiene capa de texto ahí.
  // Lo ya ubicado en un análisis anterior se reutiliza: el OCR de una página
  // tarda y esta función también corre al corregir un campo.
  for (const ev of evidence) {
    if (ev.box || !ev.documentId || !ev.page) continue;
    const box = known.get(evidenceKey(ev));
    if (box) ev.box = box;
  }
  const scanned = evidence.filter((ev) => ev.documentId && ev.page && !ev.box
    && byCaseDoc.get(ev.documentId)?.find((p) => p.pageNumber === ev.page)?.ocrMode === "scanned");
  if (scanned.length === 0) return;
  const docs = await db.query.contractDocuments.findMany({
    where: inArray(contractDocuments.id, [...new Set(scanned.map((e) => e.documentId!))]),
    columns: { id: true, storageKey: true, mimeType: true },
  });
  const cache = new Map<string, Promise<WordBox[]>>();
  for (const ev of scanned) {
    const doc = docs.find((d) => d.id === ev.documentId);
    if (!doc) continue;
    const key = `${doc.id}:${ev.page}`;
    if (!cache.has(key)) {
      if (cache.size >= MAX_OCR_PAGES) continue;
      cache.set(key, ocr(doc.storageKey, doc.mimeType ?? "application/pdf", ev.page!));
    }
    const box = matchQuote(await cache.get(key)!, ev.quote);
    if (box) ev.box = box;
  }
}

function locate(ev: EvidenceRef, byCaseDoc: Map<string, PageText[]>) {
  const candidates = ev.documentId ? [ev.documentId] : [...byCaseDoc.keys()];
  for (const id of candidates) {
    const pages = byCaseDoc.get(id);
    if (!pages?.length) continue;
    const page = findQuotePage(pages, ev.quote);
    if (page !== null) { ev.page = page; ev.documentId = id; return; }
  }
}

export async function validationRows(caseId: string, validations: ValidationResult[], caseDocumentIds: string[]) {
  const known = await knownBoxes(caseId).catch(() => new Map<string, Box>());
  await attachEvidencePages(validations, caseDocumentIds, ocrPageWords, known).catch((error) => console.warn("[contracts] no se pudo ubicar la evidencia", error instanceof Error ? error.message : error));
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
