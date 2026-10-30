import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { contractCases, contractDocuments, contractExtractionLearnings, contractValidations, contractObligations, contractVisualTrainingVariants, contractAiAnalysisResults } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { uploadFile, getFileBuffer, getFileSize } from "@/lib/storage/minio";
import { createExtractDeps, DEFAULT_CONTRACT_MODEL, type ContractExtractDeps, type ExtractSource } from "./extract";
import { AI_MODELS } from "@/lib/ai/provider";
import { countPdfPages, extractPdfPages } from "./document-pages";
import type { DocsByType } from "./validate";
import { flowSnapshot, loadContractPlan } from "./plan";
import { assembleResults, isAiRule, type AnalysisOutcome } from "./assemble";
import { buildFlowTrace } from "./trace";
import { getFeature, isFeatureEnabled } from "@/lib/features";
import { normalizeContractDate } from "./normalization";
import { logAudit } from "@/lib/audit/log";
import type { VisualTrainingVariant } from "./visual-training";
import { runAiAnalysis } from "./ai-analysis";
import { indexArchiveDocument, registerArchiveDocument } from "./archive";
import { contractArchivePages } from "@/db/schema";
import { fieldBatches, locatePages, pagesText, widenPages } from "./page-selection";
import { archiveValidationsForCase } from "./archive-validations";
import { caseVerdict } from "./validate";

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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** A value the extraction did not find (null, empty string, empty list). */
function isBlank(value: unknown): boolean {
  return value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
}

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
export async function processContractCase(caseId: string, injectedDeps?: ContractExtractDeps): Promise<void> {
  const kase = await db.query.contractCases.findFirst({ where: eq(contractCases.id, caseId) });
  if (!kase) throw new Error(`Contract case ${caseId} not found`);

  const extractionFeature = await getFeature(kase.organizationId, "contract_ai_extraction");
  if (!extractionFeature.isEnabled) {
    // Terminal, not retried: without this the case stayed "En cola" forever.
    const message = "El análisis AI de contratos fue deshabilitado antes de procesar este caso.";
    await db.update(contractCases).set({ status: "failed", errorMessage: message, updatedAt: new Date() }).where(eq(contractCases.id, caseId));
    await logAudit({ orgId: kase.organizationId, action: "contract.processing_failed", resourceType: "contract_case", resourceId: caseId, metadata: { message } });
    return;
  }

  // Model and long-document handling are per organization (feature config).
  const cfg = extractionFeature.config as { model?: unknown; locator_min_pages?: unknown; max_pages_per_call?: unknown; selected_pages_mode?: unknown };
  const model = AI_MODELS.some((m) => m.id === cfg.model) ? String(cfg.model) : DEFAULT_CONTRACT_MODEL;
  const locatorMinPages = clamp(Number(cfg.locator_min_pages) || 25, 5, 500);
  const maxPagesPerCall = clamp(Number(cfg.max_pages_per_call) || 20, 4, 40);
  const pagesMode: "auto" | "pdf" | "text" = cfg.selected_pages_mode === "pdf" || cfg.selected_pages_mode === "text" ? cfg.selected_pages_mode : "auto";
  const deps = injectedDeps ?? createExtractDeps({ model });

  await db.update(contractCases).set({ status: "processing", updatedAt: new Date() }).where(eq(contractCases.id, caseId));
  await logAudit({ orgId: kase.organizationId, action: "contract.processing_started", resourceType: "contract_case", resourceId: caseId, metadata: { model } });

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

    const summary: Array<{ documentId: string; type: string; typeName: string; fields: number; pages?: number[]; pageCount?: number }> = [];
    const docsByType: DocsByType = {};
    const referenceNode = plan.flow?.nodes.find((node) => node.kind === "reference_lookup");
    if (referenceNode) {
      if (!await isFeatureEnabled(kase.organizationId, "contract_reference_archive")) throw new Error("El flujo usa rastreo de referencias, pero la función Archivo está deshabilitada.");
      for (const doc of docs) {
        const archiveId = await registerArchiveDocument({ organizationId: kase.organizationId, storageKey: doc.storageKey, originalName: doc.originalName ?? "documento", mimeType: doc.mimeType ?? "application/pdf", caseDocumentId: doc.id, createdBy: kase.createdBy ?? undefined });
        await indexArchiveDocument(archiveId);
      }
    }

    for (const doc of docs) {
      const isPdf = doc.mimeType === "application/pdf";
      const sizeBytes = await getFileSize(doc.storageKey);
      const pageCount = isPdf ? await countPdfPages(doc.storageKey).catch(() => null) : null;
      // Long documents never go whole to the model: they are indexed page by
      // page and each field batch receives only the pages that matter to it.
      // The threshold is pages, not bytes: a 300-page born-digital PDF is small
      // on disk and huge in tokens.
      const useLocator = isPdf && ((pageCount !== null && pageCount >= locatorMinPages) || sizeBytes > 20 * 1024 * 1024);
      let pages: Array<{ pageNumber: number; text: string; ocrMode: string | null }> = [];
      if (useLocator) {
        const archiveId = await registerArchiveDocument({ organizationId: kase.organizationId, storageKey: doc.storageKey, originalName: doc.originalName ?? "documento.pdf", mimeType: doc.mimeType!, caseDocumentId: doc.id, createdBy: kase.createdBy ?? undefined });
        await indexArchiveDocument(archiveId);
        pages = await db.query.contractArchivePages.findMany({ where: eq(contractArchivePages.documentId, archiveId), orderBy: [contractArchivePages.pageNumber], columns: { pageNumber: true, text: true, ocrMode: true } });
      }
      const scannedPages = new Set(pages.filter((page) => page.ocrMode === "scanned").map((page) => page.pageNumber));
      // Located pages go as a small PDF when the model should see the page
      // (scans, or always, per config); otherwise as labelled text.
      const sourceForPages = async (pageNumbers: number[]): Promise<ExtractSource> => {
        const wantsPdf = pagesMode === "pdf" || (pagesMode === "auto" && pageNumbers.some((page) => scannedPages.has(page)));
        if (wantsPdf) {
          try {
            const pdf = await extractPdfPages(doc.storageKey, pageNumbers);
            return { kind: "file", base64: pdf.toString("base64"), mimeType: "application/pdf" };
          } catch (error) {
            console.warn("[contracts] no se pudo recortar el PDF, se envía texto", error instanceof Error ? error.message : error);
          }
        }
        return { kind: "text", text: pagesText(pages, pageNumbers) };
      };
      const pagesNote = (pageNumbers: number[]) =>
        `Recibes solo las páginas ${pageNumbers.join(", ")} de un documento de ${pageCount ?? pages.length} páginas; cuando cites, indica el número de página original.`;

      const prepared = useLocator
        ? { source: await sourceForPages(locatePages(pages, [], { maxPages: 5 }).pages), mode: scannedPages.size > 0 ? "scanned" as const : "digital" as const, text: null }
        : toSource(await getFileBuffer(doc.storageKey), doc.mimeType);
      const { source, mode, text } = prepared;

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

      let values: Record<string, unknown>;
      let citations: Record<string, unknown>;
      const pagesUsed = new Set<number>();
      if (useLocator && fields.length > 0) {
        values = {};
        citations = {};
        const typeLearnings = learningsByType.get(typeKey) ?? [];
        for (const batch of fieldBatches(fields, 12)) {
          const located = locatePages(pages, batch, { maxPages: maxPagesPerCall });
          const first = await deps.extract(await sourceForPages(located.pages), typeName, batch, undefined, typeLearnings, [], pagesNote(located.pages));
          Object.assign(values, first.values);
          Object.assign(citations, first.citations);
          for (const page of located.pages) pagesUsed.add(page);
          // Second pass: fields still empty get their next-best pages, and only
          // those fields, before anything is reported as missing.
          const missing = batch.filter((field) => isBlank(values[field.fieldKey]));
          const more = missing.length ? widenPages(located, missing.map((field) => field.fieldKey), located.pages, Math.max(4, Math.floor(maxPagesPerCall / 2))) : [];
          if (more.length > 0) {
            const second = await deps.extract(await sourceForPages(more), typeName, missing, undefined, typeLearnings, [], pagesNote(more));
            for (const field of missing) {
              if (isBlank(second.values[field.fieldKey])) continue;
              values[field.fieldKey] = second.values[field.fieldKey];
              if (second.citations[field.fieldKey] !== undefined) citations[field.fieldKey] = second.citations[field.fieldKey];
            }
            for (const page of more) pagesUsed.add(page);
          }
        }
      } else {
        ({ values, citations } = await deps.extract(source, typeName, fields, undefined, learningsByType.get(typeKey) ?? [], visualByType.get(typeKey) ?? []));
      }

      await db.update(contractDocuments).set({
        detectedType:  typeKey,
        ocrMode:       mode,
        detectedText:  text || null,
        extractedJson: values,
        citationsJson: citations,
      }).where(eq(contractDocuments.id, doc.id));

      (docsByType[typeKey] ??= []).push({ values, citations });
      summary.push({
        documentId: doc.id, type: typeKey, typeName, fields: Object.keys(values).length,
        ...(useLocator ? { pages: [...pagesUsed].sort((a, b) => a - b), pageCount: pageCount ?? pages.length } : {}),
      });
    }

    // Cross-document validation (declarative rules from the active flow or tables).
    // AI analysis is deliberately a validation kind too, but its rich response
    // is stored separately while a compact outcome participates in the same
    // verdict and approval mechanics as every other rule.
    const aiRules = plan.rules.filter(isAiRule);
    const analyses: AnalysisOutcome[] = validationsFeature
      ? await Promise.all(aiRules.map(async (configured) => {
        try {
          return {
            nodeId: configured.nodeId,
            ruleName: configured.name,
            severity: configured.severity ?? "warn",
            outputMode: configured.conditionsJson.outputMode ?? "free",
            response: await runAiAnalysis(configured.conditionsJson, docsByType),
          };
        } catch (error) {
          // A transient model/provider failure must not discard an otherwise
          // valid case. It becomes a visible review item that can be rerun.
          return {
            nodeId: configured.nodeId,
            ruleName: configured.name,
            severity: configured.severity ?? "warn",
            outputMode: configured.conditionsJson.outputMode ?? "free",
            response: {
              outcome: "review" as const,
              summary: `No se pudo completar este análisis con IA: ${error instanceof Error ? error.message : "error desconocido"}`,
              items: [],
              citations: [],
            },
          };
        }
      }))
      : [];

    // Calculations are always deterministic and use the AI items as inputs.
    const assembled = assembleResults(plan, docsByType, analyses, { validationsEnabled: validationsFeature });
    const { calculations, calculationValues } = assembled;
    const validations = referenceNode
      ? [...assembled.validations, ...await archiveValidationsForCase({ organizationId: kase.organizationId, caseDocumentIds: docs.map((doc) => doc.id), name: referenceNode.data.name, severity: referenceNode.data.severity })]
      : assembled.validations;
    const verdict = caseVerdict(validations);

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

    // Per-stage trace of the flow run (only when a visual flow is active).
    const stages = plan.flow ? buildFlowTrace(plan.flow, docsByType, summary, !!plan.template, calculations) : null;

    // Replace prior results and publish the verdict as one unit: a retry that
    // overlaps (or a crash midway) must not leave duplicated or partial rows.
    await db.transaction(async (tx) => {
      await tx.delete(contractValidations).where(eq(contractValidations.caseId, caseId));
      if (validations.length > 0) {
        await tx.insert(contractValidations).values(validations.map((v) => ({
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

      await tx.delete(contractAiAnalysisResults).where(eq(contractAiAnalysisResults.caseId, caseId));
      if (analyses.length > 0) {
        await tx.insert(contractAiAnalysisResults).values(analyses.map((analysis) => ({
          id: randomUUID(),
          caseId,
          ruleName: analysis.ruleName,
          severity: analysis.response.outcome === "block" ? "block" : analysis.severity,
          outputMode: analysis.outputMode,
          outcome: analysis.response.outcome,
          summary: analysis.response.summary,
          itemsJson: analysis.response.items,
          citationsJson: analysis.response.citations,
        })));
      }

      await tx.delete(contractObligations).where(eq(contractObligations.caseId, caseId));
      if (obligations.length > 0) {
        await tx.insert(contractObligations).values(obligations.map((o) => ({ caseId, type: o.type, description: o.description, dueDate: o.dueDate, alertAt: o.alertAt, status: "open" })));
      }

      await tx.update(contractCases).set({
        status: "validated",
        // Pin the flow actually used; generation and corrections replay this
        // snapshot even if the live flow changes or disappears.
        flowId: plan.flowId,
        resultJson: {
          documents: summary,
          validations: validations.length,
          analyses: analyses.length,
          calculations,
          calculationValues,
          verdict,
          flow: { source: plan.source, stages, snapshot: flowSnapshot(plan) },
        },
        updatedAt: new Date(),
      }).where(eq(contractCases.id, caseId));
    });
    await logAudit({
      orgId: kase.organizationId,
      action: "contract.processing_completed",
      resourceType: "contract_case",
      resourceId: caseId,
      metadata: { documents: summary.length, validations: validations.length, analyses: analyses.length, verdict },
    });
    if (await isFeatureEnabled(kase.organizationId, "contract_reference_archive")) {
      for (const doc of docs) {
        try {
          const archiveId = await registerArchiveDocument({ organizationId: kase.organizationId, storageKey: doc.storageKey, originalName: doc.originalName ?? "documento", mimeType: doc.mimeType ?? "application/pdf", caseDocumentId: doc.id, createdBy: kase.createdBy ?? undefined });
          await (await import("@/lib/queue")).enqueueArchiveDocument(archiveId);
        } catch (error) {
          console.error("[contracts] archive enqueue failed", error);
        }
      }
    }
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
