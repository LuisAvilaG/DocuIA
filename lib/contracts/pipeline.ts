import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { contractCases, contractDocuments, contractValidations, contractObligations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { uploadFile, getFileBuffer } from "@/lib/storage/minio";
import { realExtractDeps, type ContractExtractDeps, type ExtractSource } from "./extract";
import { runValidations, caseVerdict, type DocsByType } from "./validate";
import { loadContractPlan } from "./plan";
import { buildFlowTrace } from "./trace";

export interface CaseFileInput { buffer: Buffer; fileName: string; mimeType: string }

// Loose date parser for extracted strings (YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, or native).
function parseDateLoose(v: unknown): Date | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// Fields whose value is a key date worth alerting on (renewal / expiry).
const DATE_FIELD_RE = /(fecha|date|vigencia|termino|término|renov|corte|vencim)/i;

// Create the case + persist files to MinIO + document rows. Returns the case id.
export async function createContractCase(input: {
  organizationId: string;
  createdBy?: string;
  title?: string;
  flowId?: string | null;
  files: CaseFileInput[];
}): Promise<string> {
  const caseId = randomUUID();
  await db.insert(contractCases).values({
    id: caseId,
    organizationId: input.organizationId,
    flowId: input.flowId ?? null,
    title: input.title ?? null,
    status: "uploaded",
    createdBy: input.createdBy ?? null,
  });

  for (const f of input.files) {
    const storageKey = `contracts/${input.organizationId}/${caseId}/${Date.now()}-${f.fileName}`;
    await uploadFile(f.buffer, storageKey, f.mimeType);
    await db.insert(contractDocuments).values({
      id: randomUUID(),
      caseId,
      storageKey,
      originalName: f.fileName,
      mimeType: f.mimeType,
    });
  }
  return caseId;
}

// Build the AI source per document: TXT/XML are decoded to text (born-digital);
// PDFs/images are sent to Gemini as inline_data for OCR + understanding.
function toSource(buffer: Buffer, mimeType: string | null): { source: ExtractSource; mode: "digital" | "scanned"; text: string | null } {
  const mt = (mimeType ?? "").toLowerCase();
  if (mt.startsWith("text/") || mt.includes("xml")) {
    const text = buffer.toString("utf8");
    return { source: { kind: "text", text }, mode: "digital", text };
  }
  return { source: { kind: "file", base64: buffer.toString("base64"), mimeType: mimeType || "application/pdf" }, mode: "scanned", text: null };
}

// Process a case off-thread: classify each doc, extract configured fields with
// citations, persist, and move the case to "review". Extractor is injectable
// so the orchestration can be tested without an AI key.
export async function processContractCase(caseId: string, deps: ContractExtractDeps = realExtractDeps): Promise<void> {
  const kase = await db.query.contractCases.findFirst({ where: eq(contractCases.id, caseId) });
  if (!kase) throw new Error(`Contract case ${caseId} not found`);

  await db.update(contractCases).set({ status: "processing", updatedAt: new Date() }).where(eq(contractCases.id, caseId));

  try {
    const [docs, plan] = await Promise.all([
      db.query.contractDocuments.findMany({ where: eq(contractDocuments.caseId, caseId) }),
      loadContractPlan(kase.organizationId, kase.flowId),
    ]);

    const summary: Array<{ documentId: string; type: string; typeName: string; fields: number }> = [];
    const docsByType: DocsByType = {};

    for (const doc of docs) {
      const buffer = await getFileBuffer(doc.storageKey);
      const { source, mode, text } = toSource(buffer, doc.mimeType);

      const typeKey = await deps.classify(source, plan.docTypes);
      const typeName = plan.docTypes.find((t) => t.key === typeKey)?.name ?? typeKey;
      const fields = plan.fieldsByType[typeKey] ?? plan.fieldsByType[plan.docTypes[0]?.key] ?? [];

      const { values, citations } = await deps.extract(source, typeName, fields);

      await db.update(contractDocuments).set({
        detectedType:  typeKey,
        ocrMode:       mode,
        detectedText:  text || null,
        extractedJson: values,
        citationsJson: citations,
      }).where(eq(contractDocuments.id, doc.id));

      (docsByType[typeKey] ??= []).push({ values, citations });
      summary.push({ documentId: doc.id, type: typeKey, typeName, fields: Object.keys(values).length });
    }

    // Cross-document validation (declarative rules from the active flow or tables).
    const validations = runValidations(plan.rules, docsByType, new Date());
    const verdict = caseVerdict(validations);

    // Replace any prior validations for this case, then persist fresh results.
    await db.delete(contractValidations).where(eq(contractValidations.caseId, caseId));
    if (validations.length > 0) {
      await db.insert(contractValidations).values(validations.map((v) => ({
        caseId,
        ruleName:   v.ruleName,
        severity:   v.severity,
        subject:    v.subject,
        status:     v.status,
        ok:         v.ok,
        reason:     v.reason,
        checksJson: v.checks,
        citation:   v.citation,
      })));
    }

    // Derive key-date obligations (renewal/expiry) → alert 30 days before.
    const obligations: Array<{ type: string; description: string; dueDate: Date; alertAt: Date }> = [];
    for (const list of Object.values(docsByType)) {
      for (const d of list) {
        for (const [k, val] of Object.entries(d.values)) {
          if (!DATE_FIELD_RE.test(k)) continue;
          const due = parseDateLoose(Array.isArray(val) ? val[0] : val);
          if (!due) continue;
          obligations.push({ type: k, description: `${k}: ${Array.isArray(val) ? val[0] : val}`, dueDate: due, alertAt: new Date(due.getTime() - 30 * 86400_000) });
        }
      }
    }
    await db.delete(contractObligations).where(eq(contractObligations.caseId, caseId));
    if (obligations.length > 0) {
      await db.insert(contractObligations).values(obligations.map((o) => ({ caseId, type: o.type, description: o.description, dueDate: o.dueDate, alertAt: o.alertAt, status: "open" })));
    }

    // Per-stage trace of the flow run (only when a visual flow is active).
    const stages = plan.flow ? buildFlowTrace(plan.flow, docsByType, summary, !!plan.template) : null;

    await db.update(contractCases).set({
      status: "validated",
      resultJson: {
        documents: summary,
        validations: validations.length,
        verdict,
        flow: { source: plan.source, stages },
      },
      updatedAt: new Date(),
    }).where(eq(contractCases.id, caseId));
  } catch (err) {
    await db.update(contractCases).set({
      status: "failed",
      errorMessage: err instanceof Error ? err.message : String(err),
      updatedAt: new Date(),
    }).where(eq(contractCases.id, caseId));
    throw err;
  }
}
