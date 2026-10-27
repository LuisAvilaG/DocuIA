import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { contractArchiveDocuments, contractArchiveReferences } from "@/db/schema";
import type { ValidationResult, Severity } from "./validate";

export async function archiveValidationsForCase(input: { organizationId: string; caseDocumentIds: string[]; name: string; severity: Severity }): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];
  for (const caseDocumentId of input.caseDocumentIds) {
    const archiveDoc = await db.query.contractArchiveDocuments.findFirst({ where: and(eq(contractArchiveDocuments.organizationId, input.organizationId), eq(contractArchiveDocuments.caseDocumentId, caseDocumentId)) });
    if (!archiveDoc) continue;
    const refs = await db.query.contractArchiveReferences.findMany({ where: eq(contractArchiveReferences.sourceDocumentId, archiveDoc.id) });
    for (const ref of refs) {
      if (ref.status === "rejected") continue; // reviewer marked a false-positive citation
      const ok = ["related", "confirmed"].includes(ref.status) ? true : ref.status === "unrelated" || (ref.status === "missing" && input.severity === "block") ? false : null;
      results.push({ ruleName: input.name, severity: input.severity, subject: ref.rawCode, ok, status: ok === true ? "pertinente" : ok === false ? "no pertinente" : "requiere revisión", reason: ref.reason ?? (ref.targetDocumentId ? "Documento origen encontrado." : "Documento origen no localizado."), checks: [{ label: `Referencia en página ${ref.pageNumber}`, ok: true }, { label: "Origen y asunto", ok }], citation: ref.context });
    }
  }
  if (results.length === 0) results.push({ ruleName: input.name, severity: input.severity, subject: "Referencias documentales", ok: null, status: "sin referencias", reason: "No se detectaron códigos de otros documentos en este caso.", checks: [], citation: null });
  return results;
}
