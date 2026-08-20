import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { contractCases, contractDocuments, contractExtractionLearnings, contractValidations, contractObligations, contractVisualTrainingVariants } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { uploadFile, getFileBuffer } from "@/lib/storage/minio";
import { realExtractDeps, type ContractExtractDeps, type ExtractSource } from "./extract";
import { runValidations, caseVerdict, type DocsByType } from "./validate";
import { loadContractPlan } from "./plan";
import { buildFlowTrace } from "./trace";
import { getFeature, isFeatureEnabled } from "@/lib/features";
import { normalizeContractDate } from "./normalization";
import { logAudit } from "@/lib/audit/log";
import type { VisualTrainingVariant } from "./visual-training";

export interface CaseFileInput { buffer: Buffer; fileName: string; mimeType: string }

// Dates read from documents are normalized before obligation alerts are created.
function parseDateLoose(v: unknown): Date | null {
  const normalized = normalizeContractDate(v);
  if (!normalized) return null;
  const [year, month, day] = normalized.split("-").map(Number);
  return new Date(year, month - 1, day);
}

// Fields whose value is a key date worth alerting on (renewal / expiry).
const DATE_FIELD_RE = /(fecha|date|vigencia|termino|término|renov|corte|vencim)/i;

function normalizeName(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// A filename is a useful, deterministic tie-breaker for a deliberately named
// upload such as "Cotizacion_demo...". It is only used when the model returned
// unknown; a recognised model result always wins.
function inferTypeFromFileName(fileName: string | null, docTypes: Array<{ key: string; name: string }>): string | null {
  if (!fileName) return null;
  const words = new Set(normalizeName(fileName).split(" ").filter((word) => word.length >= 4));
  if (words.size === 0) return null;
  for (const docType of docTypes) {
    const aliases = `${docType.key} ${docType.name}`.split(/[_\s-]+/).map(normalizeName).filter((word) => word.length >= 4);
    if (aliases.some((alias) => words.has(alias))) return docType.key;
  }
  return null;
}

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

  if (!await isFeatureEnabled(kase.organizationId, "contract_ai_extraction")) {
    throw new Error("El análisis AI de contratos fue deshabilitado antes de procesar este caso.");
  }

  await db.update(contractCases).set({ status: "processing", updatedAt: new Date() }).where(eq(contractCases.id, caseId));
  await logAudit({ orgId: kase.organizationId, action: "contract.processing_started", resourceType: "contract_case", resourceId: caseId });

  try {
    const [docs, plan, validationsFeature, obligationsFeature, learnings] = await Promise.all([
      db.query.contractDocuments.findMany({ where: eq(contractDocuments.caseId, caseId) }),
      loadContractPlan(kase.organizationId, kase.flowId),
      isFeatureEnabled(kase.organizationId, "contract_advanced_validations"),
      getFeature(kase.organizationId, "contract_obligation_tracking"),
      db.query.contractExtractionLearnings.findMany({
        where: and(eq(contractExtractionLearnings.organizationId, kase.organizationId), eq(contractExtractionLearnings.isActive, true)),
        orderBy: [desc(contractExtractionLearnings.createdAt)],
        columns: { documentType: true, fieldKey: true, originalValue: true, correctedValue: true, citation: true },
      }),
    ]);
    // A visual guide is scoped to the exact flow selected for this case. It is
    // optional by design: documents without a matching trained layout retain
    // the regular whole-document extraction path.
    const visualRows = plan.flowId ? await db.query.contractVisualTrainingVariants.findMany({
      where: and(
        eq(contractVisualTrainingVariants.organizationId, kase.organizationId),
        eq(contractVisualTrainingVariants.flowId, plan.flowId),
        eq(contractVisualTrainingVariants.isActive, true),
      ),
      columns: { id: true, name: true, documentType: true, signatureText: true, mappingsJson: true },
    }) : [];
    const visualByType = new Map<string, VisualTrainingVariant[]>();
    for (const row of visualRows) {
      const rawMappings = Array.isArray(row.mappingsJson) ? row.mappingsJson : [];
      const mappings = rawMappings.filter((mapping): mapping is VisualTrainingVariant["mappings"][number] =>
        !!mapping && typeof mapping === "object" &&
        typeof (mapping as { fieldKey?: unknown }).fieldKey === "string" &&
        Number.isInteger((mapping as { page?: unknown }).page) &&
        ["x", "y", "width", "height"].every((key) => typeof (mapping as Record<string, unknown>)[key] === "number"),
      );
      (visualByType.get(row.documentType) ?? visualByType.set(row.documentType, []).get(row.documentType)!).push({
        id: row.id, name: row.name, documentType: row.documentType, signatureText: row.signatureText, mappings,
      });
    }
    const learningsByType = new Map<string, typeof learnings>();
    for (const learning of learnings) (learningsByType.get(learning.documentType) ?? learningsByType.set(learning.documentType, []).get(learning.documentType)!).push(learning);

    const summary: Array<{ documentId: string; type: string; typeName: string; fields: number }> = [];
    const docsByType: DocsByType = {};

    for (const doc of docs) {
      const buffer = await getFileBuffer(doc.storageKey);
      const { source, mode, text } = toSource(buffer, doc.mimeType);

      const classifiedTypeKey = await deps.classify(source, plan.docTypes, undefined, doc.originalName ?? undefined);
      const typeKey = plan.docTypes.some((type) => type.key === classifiedTypeKey)
        ? classifiedTypeKey
        : inferTypeFromFileName(doc.originalName, plan.docTypes) ?? (plan.docTypes.length === 1 ? plan.docTypes[0].key : "unknown");
      const typeName = plan.docTypes.find((t) => t.key === typeKey)?.name ?? typeKey;
      // Never extract with another type's schema. The old fallback made an
      // unknown document look like the first intake type in the UI while its
      // values were stored under "unknown", so downstream rules could never
      // find them.
      const fields = plan.fieldsByType[typeKey] ?? [];

      const { values, citations } = await deps.extract(source, typeName, fields, undefined, learningsByType.get(typeKey) ?? [], visualByType.get(typeKey) ?? []);

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
    const validations = validationsFeature ? runValidations(plan.rules, docsByType, new Date()) : [];
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

    // Derive key-date obligations (renewal/expiry) using the tenant-configured alert lead time.
    const obligations: Array<{ type: string; description: string; dueDate: Date; alertAt: Date }> = [];
    if (obligationsFeature.isEnabled) {
      const days = Math.min(365, Math.max(1, Math.round(Number(obligationsFeature.config.alert_days_before ?? 30))));
      for (const list of Object.values(docsByType)) {
        for (const d of list) {
          for (const [k, val] of Object.entries(d.values)) {
            if (!DATE_FIELD_RE.test(k)) continue;
            const due = parseDateLoose(Array.isArray(val) ? val[0] : val);
            if (!due) continue;
            obligations.push({ type: k, description: `${k}: ${Array.isArray(val) ? val[0] : val}`, dueDate: due, alertAt: new Date(due.getTime() - days * 86400_000) });
          }
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
    await logAudit({
      orgId: kase.organizationId,
      action: "contract.processing_completed",
      resourceType: "contract_case",
      resourceId: caseId,
      metadata: { documents: summary.length, validations: validations.length, verdict },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(contractCases).set({
      status: "failed",
      errorMessage: message,
      updatedAt: new Date(),
    }).where(eq(contractCases.id, caseId));
    await logAudit({ orgId: kase.organizationId, action: "contract.processing_failed", resourceType: "contract_case", resourceId: caseId, metadata: { message } });
    throw err;
  }
}
