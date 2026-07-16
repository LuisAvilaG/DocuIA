import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { historyDocuments, exceptionQueue, organizations, usageDaily } from "@/db/schema";
import { and, eq, ne, sql } from "drizzle-orm";
import { uploadFile } from "@/lib/storage/minio";
import { extractFromFile } from "./extract";
import { buildUiPayload } from "./match";
import { processInNetSuite } from "./process-ns";
import { logWorkflow } from "./log";
import { parseCfdi } from "./cfdi-parser";
import { deliverWebhooks } from "@/lib/webhooks/deliver";
import { getAllFeatures, isFeatureEnabled } from "@/lib/features";
import { decryptField } from "@/lib/crypto/encrypt";
import { upsertItemMappings } from "./mappings";

export type PipelineInput = {
  organizationId: string;
  subsidiaryId:   string;
  documentType:   "invoice" | "purchase_order" | "xml_cfdi";
  fileName:       string;
  mimeType:       string;
  fileBuffer:     Buffer;
  requestedBy?:   string;
  autoProcessThreshold?: number;
  // Set by the queue path: an already-created history row + already-stored file.
  // When present, runPipeline processes that document instead of creating a new one.
  documentId?:    number;
  storageKey?:    string;
};

export type PipelineResult =
  | { status: "review";            documentId: number; payload: Record<string, unknown> }
  | { status: "pending_approval";  documentId: number }
  | { status: "completed";         documentId: number; netsuiteId: string | null; recordUrl: string | null }
  | { status: "failed";            documentId: number; error: string };

// ─── Feature loader ──────────────────────────────────────────────────────────
async function loadFeatures(organizationId: string) {
  const all = await getAllFeatures(organizationId);
  const map = new Map(all.map(f => [f.id, f]));
  return {
    isEnabled: (id: string) => map.get(id)?.isEnabled ?? false,
    getConfig: (id: string) => (map.get(id)?.config ?? {}) as Record<string, unknown>,
  };
}

/**
 * Queue path: store the file and create the history row up-front so the HTTP
 * response can return a documentId immediately. The worker later calls
 * runPipeline() with { documentId, storageKey } to process it off-thread.
 */
export async function createQueuedDocument(input: PipelineInput): Promise<{ documentId: number; storageKey: string }> {
  const storageKey = `${input.organizationId}/${input.subsidiaryId}/${Date.now()}-${input.fileName}`;
  await uploadFile(input.fileBuffer, storageKey, input.mimeType);
  const [doc] = await db
    .insert(historyDocuments)
    .values({
      organizationId: input.organizationId,
      subsidiaryId:   input.subsidiaryId,
      documentType:   input.documentType,
      status:         "uploaded",
      storageKey,
      processedBy:    input.requestedBy ?? null,
    })
    .returning({ id: historyDocuments.id });
  return { documentId: doc.id, storageKey };
}

export async function runPipeline(input: PipelineInput): Promise<PipelineResult> {
  const requestId = randomUUID();
  const t0 = Date.now();

  // ── Load org config (AI key + features) ──────────────────────────────────
  const [orgRow, feat] = await Promise.all([
    db.query.organizations.findFirst({
      where: eq(organizations.id, input.organizationId),
      columns: { aiApiKeyEncrypted: true },
    }),
    loadFeatures(input.organizationId),
  ]);

  const orgApiKey = orgRow?.aiApiKeyEncrypted
    ? decryptField(orgRow.aiApiKeyEncrypted)
    : undefined;

  const storageEnabled        = feat.isEnabled("document_storage");
  const fallbackEnabled       = feat.isEnabled("ai_tiered_fallback");
  const forceSecondary        = feat.isEnabled("ai_force_secondary");
  const detectDupes           = feat.isEnabled("duplicate_detection");
  const approvalRequired      = feat.isEnabled("approval_workflow");
  const exceptionQueueEnabled = feat.isEnabled("exception_queue");
  const customForms     = feat.getConfig("custom_netsuite_forms") as {
    invoice_customform_id?: string;
    po_customform_id?: string;
  };
  const poConfig = feat.getConfig("po_processing") as {
    apply_to_po_lines?: boolean;
    set_unselected_po_lines_to_zero?: boolean;
    allow_additional_lines?: boolean;
  };

  const storageKey = input.storageKey
    ?? `${input.organizationId}/${input.subsidiaryId}/${Date.now()}-${input.fileName}`;

  // ── 1. Persist to storage ────────────────────────────────────────────────
  // Skip when the queue path already stored the file (input.storageKey set).
  if (storageEnabled && !input.storageKey) {
    await uploadFile(input.fileBuffer, storageKey, input.mimeType);
  }

  // ── 2. Create (or reuse) history record ───────────────────────────────────
  let docId: number;
  if (input.documentId) {
    // Queue path: row already exists (status "uploaded") — move it to extracting.
    docId = input.documentId;
    await db.update(historyDocuments)
      .set({ status: "extracting", updatedAt: new Date() })
      .where(eq(historyDocuments.id, docId));
  } else {
    const [doc] = await db
      .insert(historyDocuments)
      .values({
        organizationId: input.organizationId,
        subsidiaryId:   input.subsidiaryId,
        documentType:   input.documentType,
        status:         "extracting",
        storageKey:     storageEnabled ? storageKey : null,
        processedBy:    input.requestedBy ?? null,
      })
      .returning({ id: historyDocuments.id });
    docId = doc.id;
  }

  await logWorkflow({
    organizationId: input.organizationId,
    requestId,
    stage:          "pipeline",
    step:           "start",
    status:         "STARTED",
    documentType:   input.documentType,
  });

  const usageDelta = {
    docsProcessed:   1,
    docsInvoice:     input.documentType === "invoice" ? 1 : 0,
    docsPo:          input.documentType === "purchase_order" ? 1 : 0,
    docsXml:         input.documentType === "xml_cfdi" ? 1 : 0,
    aiPrimaryCalls:  0,
    aiFallbackCalls: 0,
    aiTokensInput:   0,
    aiTokensOutput:  0,
    errors:          0,
    totalAmount:     "0",
  };

  try {
    // ── 3. Extract ────────────────────────────────────────────────────────
    const t1 = Date.now();
    const isCfdiXml = input.documentType === "xml_cfdi" ||
      input.mimeType === "text/xml" || input.mimeType === "application/xml";

    let extraction: Awaited<ReturnType<typeof extractFromFile>>;

    if (isCfdiXml) {
      const xmlText  = input.fileBuffer.toString("utf8");
      const cfdiData = parseCfdi(xmlText);
      extraction = {
        invoice: {
          format:        "general",
          vendor:        cfdiData.emisorNombre || cfdiData.emisorRfc,
          invoiceNumber: cfdiData.folio || cfdiData.uuid.slice(0, 8),
          invoiceDate:   cfdiData.fecha ? cfdiData.fecha.slice(0, 10) : "",
          dueDate:       "",
          purchaseOrder: "",
          currency:      cfdiData.moneda,
          subtotal:      cfdiData.subTotal,
          // Real transferred taxes (IVA), not the old total − subtotal which
          // conflated descuento and retenciones. Total stays authoritative from
          // the CFDI (already nets descuento/retenciones per the SAT formula).
          tax:           cfdiData.totalTraslados,
          total:         cfdiData.total,
          lines:         cfdiData.lineas.map(l => ({
            description: l.descripcion,
            quantity:    l.cantidad,
            rate:        l.valorUnitario,
            amount:      l.importe,
            uom:         l.claveUnidad || null,
            itemCode:    l.noIdentificacion || null,
          })),
        },
        model:            "cfdi-parser",
        fallbackUsed:     false,
        rawJson:          "",
        promptTokens:     0,
        completionTokens: 0,
      };
    } else {
      const base64Content = input.fileBuffer.toString("base64");
      extraction = await extractFromFile({
        fileName:      input.fileName,
        mimeType:      input.mimeType,
        base64Content,
        options: { fallbackEnabled, forceSecondary, apiKey: orgApiKey },
      });
    }

    await logWorkflow({
      organizationId: input.organizationId,
      requestId,
      stage:          "pipeline",
      step:           "extract",
      status:         "SUCCESS",
      model:          extraction.model,
      engine:         extraction.fallbackUsed ? "secondary" : "primary",
      documentType:   input.documentType,
      vendor:         extraction.invoice.vendor || undefined,
      invoiceNumber:  extraction.invoice.invoiceNumber || undefined,
      lineCount:      extraction.invoice.lines.length,
      durationMs:     Date.now() - t1,
      fallbackUsed:   extraction.fallbackUsed,
      metaJson:       { promptTokens: extraction.promptTokens, completionTokens: extraction.completionTokens },
    });

    if (!isCfdiXml) {
      usageDelta.aiPrimaryCalls  = extraction.fallbackUsed ? 0 : 1;
      usageDelta.aiFallbackCalls = extraction.fallbackUsed ? 1 : 0;
      usageDelta.aiTokensInput   = extraction.promptTokens;
      usageDelta.aiTokensOutput  = extraction.completionTokens;
    }

    // ── 4. Duplicate detection (after extraction — we need vendor + number) ──
    if (detectDupes && extraction.invoice.vendor && extraction.invoice.invoiceNumber) {
      const existing = await db.query.historyDocuments.findFirst({
        where: and(
          eq(historyDocuments.organizationId, input.organizationId),
          eq(historyDocuments.vendor, extraction.invoice.vendor),
          eq(historyDocuments.numDoc, extraction.invoice.invoiceNumber),
          ne(historyDocuments.id, docId),
          ne(historyDocuments.status, "failed"),
        ),
      });
      if (existing) {
        throw new Error(
          `Factura duplicada: ${extraction.invoice.vendor} #${extraction.invoice.invoiceNumber} ya existe (doc #${existing.id})`
        );
      }
    }

    // ── 5. Update history with extracted header ───────────────────────────
    await db.update(historyDocuments).set({
      status:           "review",
      vendor:           extraction.invoice.vendor || null,
      numDoc:           extraction.invoice.invoiceNumber || null,
      total:            extraction.invoice.total?.toString() ?? null,
      extractionEngine: extraction.model,
      fallbackUsed:     extraction.fallbackUsed,
      updatedAt:        new Date(),
    }).where(eq(historyDocuments.id, docId));

    // ── 6. Match catalog ──────────────────────────────────────────────────
    const t2 = Date.now();
    const payload = await buildUiPayload(extraction.invoice, input.subsidiaryId, {
      engine: extraction.fallbackUsed ? "secondary" : "primary",
      meta:   { requestId, documentId: docId },
    });

    await logWorkflow({
      organizationId: input.organizationId,
      requestId,
      stage:          "pipeline",
      step:           "match",
      status:         "SUCCESS",
      durationMs:     Date.now() - t2,
      lineCount:      payload.document.lines.length,
    });

    // ── 7. Decide: auto-process or send to review ─────────────────────────
    const envThreshold    = process.env.WORKFLOW_AUTO_PROCESS_THRESHOLD?.trim();
    const rawEnvThreshold = envThreshold ? Number(envThreshold) : NaN;
    const autoProcessThreshold =
      typeof input.autoProcessThreshold === "number" && input.autoProcessThreshold > 0
        ? Math.min(1, input.autoProcessThreshold)
        : Number.isFinite(rawEnvThreshold) && rawEnvThreshold > 0
        ? Math.min(1, rawEnvThreshold)
        : 0.85;

    const autoProcess =
      payload.confidence.overall >= autoProcessThreshold &&
      payload.document.lines.every((l) => l.selected_item_id !== null) &&
      Boolean(payload.document.vendor.selected_internal_id);

    if (!autoProcess) {
      await db.update(historyDocuments)
        .set({ products: payload as unknown, updatedAt: new Date() })
        .where(eq(historyDocuments.id, docId));

      await logWorkflow({
        organizationId: input.organizationId,
        requestId,
        stage:     "pipeline",
        step:      "decision",
        status:    "INFO",
        metaJson:  { reason: "needs_review", confidence: payload.confidence },
        durationMs: Date.now() - t0,
      });

      void deliverWebhooks(input.organizationId, "document.review", {
        document: {
          id: docId, status: "review", documentType: input.documentType,
          vendor: extraction.invoice.vendor || null,
          total:  extraction.invoice.total?.toString() ?? null,
        },
      });

      return { status: "review", documentId: docId, payload: payload as unknown as Record<string, unknown> };
    }

    // ── 8. Pending approval (confidence OK but admin must approve) ────────
    if (approvalRequired) {
      await db.update(historyDocuments)
        .set({ status: "pending_approval", products: payload as unknown, updatedAt: new Date() })
        .where(eq(historyDocuments.id, docId));

      await logWorkflow({
        organizationId: input.organizationId,
        requestId,
        stage:     "pipeline",
        step:      "decision",
        status:    "INFO",
        metaJson:  { reason: "approval_required", confidence: payload.confidence },
        durationMs: Date.now() - t0,
      });

      return { status: "pending_approval", documentId: docId };
    }

    // ── 9. Send to NetSuite ───────────────────────────────────────────────
    await db.update(historyDocuments).set({ status: "processing", updatedAt: new Date() })
      .where(eq(historyDocuments.id, docId));

    // Read dry_run fresh here so tenant changes during processing take effect
    const dryRun = await isFeatureEnabled(input.organizationId, "netsuite_dry_run");

    const isPoType = input.documentType === "purchase_order";
    const customFormId = isPoType
      ? (customForms.po_customform_id || "")
      : (customForms.invoice_customform_id || "");

    const t3 = Date.now();
    const nsResult = await processInNetSuite(
      input.organizationId,
      buildNsPayload(payload, input.subsidiaryId, input.documentType, {
        dryRun,
        customFormId: customFormId || undefined,
        poConfig,
        externalId: `docuia:${input.organizationId}:${docId}`,
      })
    );

    await db.update(historyDocuments).set({
      status:        "completed",
      netsuiteDocId: nsResult.internalId ?? null,
      urlNetsuite:   nsResult.recordUrl ?? null,
      updatedAt:     new Date(),
    }).where(eq(historyDocuments.id, docId));

    await logWorkflow({
      organizationId: input.organizationId,
      requestId,
      stage:     "pipeline",
      step:      "process_ns",
      status:    "SUCCESS",
      durationMs: Date.now() - t3,
      metaJson:  { netsuiteId: nsResult.internalId, recordUrl: nsResult.recordUrl, dryRun },
    });

    void deliverWebhooks(input.organizationId, "document.completed", {
      document: {
        id: docId, status: "completed", documentType: input.documentType,
        vendor:       extraction.invoice.vendor || null,
        total:        extraction.invoice.total?.toString() ?? null,
        netsuiteDocId: nsResult.internalId,
        recordUrl:     nsResult.recordUrl,
      },
    });

    usageDelta.totalAmount = (extraction.invoice.total ?? 0).toString();

    void upsertItemMappings(
      payload.document.lines
        .filter((l) => l.selected_item_id)
        .map((l) => {
          const selectedCandidate = l.candidates.find((c) => c.internal_id === l.selected_item_id);
          return {
            subsidiaryId:       input.subsidiaryId,
            vendor:             extraction.invoice.vendor || "",
            vendorItemName:     l.description,
            netsuiteInternalId: l.selected_item_id!,
            netsuiteItemName:   selectedCandidate?.name ?? null,
            netsuiteUnit:       l.selected_unit_id ?? null,
            autoMap:            true,
          };
        })
    ).catch(() => {});

    return {
      status:     "completed",
      documentId: docId,
      netsuiteId: nsResult.internalId,
      recordUrl:  nsResult.recordUrl,
    };

  } catch (err) {
    usageDelta.errors = 1;
    const errorMessage = err instanceof Error ? err.message : String(err);

    await db.update(historyDocuments).set({
      status:       "failed",
      errorMessage,
      updatedAt:    new Date(),
    }).where(eq(historyDocuments.id, docId));

    if (exceptionQueueEnabled) {
      await db.insert(exceptionQueue).values({
        organizationId:   input.organizationId,
        subsidiaryId:     input.subsidiaryId,
        documentType:     input.documentType,
        originalFilename: input.fileName,
        storageKey:       storageEnabled ? storageKey : null,
        failureStage:     determineFailureStage(errorMessage),
        failureReason:    errorMessage,
        status:           "pending",
      });
    }

    await logWorkflow({
      organizationId: input.organizationId,
      requestId,
      stage:     "pipeline",
      step:      "error",
      status:    "FAILED",
      durationMs: Date.now() - t0,
      errorMessage,
    });

    void deliverWebhooks(input.organizationId, "document.failed", {
      document: {
        id: docId, status: "failed", documentType: input.documentType,
        vendor: null, total: null, error: errorMessage,
      },
    });

    return { status: "failed", documentId: docId, error: errorMessage };
  } finally {
    void upsertUsageDaily(input.organizationId, usageDelta).catch(() => {});
  }
}

async function upsertUsageDaily(organizationId: string, delta: {
  docsProcessed: number; docsInvoice: number; docsPo: number; docsXml: number;
  aiPrimaryCalls: number; aiFallbackCalls: number; aiTokensInput: number; aiTokensOutput: number;
  errors: number; totalAmount: string;
}) {
  const date = new Date().toISOString().slice(0, 10);
  await db.insert(usageDaily).values({
    organizationId, date,
    docsProcessed:   delta.docsProcessed,
    docsInvoice:     delta.docsInvoice,
    docsPo:          delta.docsPo,
    docsXml:         delta.docsXml,
    aiPrimaryCalls:  delta.aiPrimaryCalls,
    aiFallbackCalls: delta.aiFallbackCalls,
    aiTokensInput:   delta.aiTokensInput,
    aiTokensOutput:  delta.aiTokensOutput,
    errors:          delta.errors,
    totalAmount:     delta.totalAmount,
  }).onConflictDoUpdate({
    target: [usageDaily.organizationId, usageDaily.date],
    set: {
      docsProcessed:   sql`${usageDaily.docsProcessed} + ${delta.docsProcessed}`,
      docsInvoice:     sql`${usageDaily.docsInvoice} + ${delta.docsInvoice}`,
      docsPo:          sql`${usageDaily.docsPo} + ${delta.docsPo}`,
      docsXml:         sql`${usageDaily.docsXml} + ${delta.docsXml}`,
      aiPrimaryCalls:  sql`${usageDaily.aiPrimaryCalls} + ${delta.aiPrimaryCalls}`,
      aiFallbackCalls: sql`${usageDaily.aiFallbackCalls} + ${delta.aiFallbackCalls}`,
      aiTokensInput:   sql`${usageDaily.aiTokensInput} + ${delta.aiTokensInput}`,
      aiTokensOutput:  sql`${usageDaily.aiTokensOutput} + ${delta.aiTokensOutput}`,
      errors:          sql`${usageDaily.errors} + ${delta.errors}`,
      totalAmount:     sql`${usageDaily.totalAmount} + ${delta.totalAmount}`,
      updatedAt:       new Date(),
    },
  });
}

type UiPayload = Awaited<ReturnType<typeof buildUiPayload>>;

function buildNsPayload(
  payload:       UiPayload,
  subsidiaryId:  string,
  documentType:  string,
  options: {
    dryRun?:       boolean;
    customFormId?: string;
    externalId?:   string;
    poConfig?:     { apply_to_po_lines?: boolean; set_unselected_po_lines_to_zero?: boolean; allow_additional_lines?: boolean };
  } = {}
): Record<string, unknown> {
  const { dryRun = false, customFormId, externalId, poConfig = {} } = options;
  return {
    documentType,
    dry_run:                     dryRun,
    ...(customFormId ? { customform_id: customFormId } : {}),
    ...(externalId ? { external_id: externalId } : {}),
    subsidiary_internal_id:      subsidiaryId,
    vendor_id:                   payload.document.vendor.selected_internal_id,
    document_number:             payload.document.invoice_number,
    date:                        payload.document.invoice_date,
    due_date:                    payload.document.due_date,
    currency_internal_id:        payload.document.currency,
    apply_to_po_lines:           poConfig.apply_to_po_lines            ?? true,
    set_unselected_po_lines_to_zero: poConfig.set_unselected_po_lines_to_zero ?? false,
    allow_additional_lines:      poConfig.allow_additional_lines        ?? true,
    line_items: payload.document.lines.map((l) => ({
      internal_id:         l.selected_item_id,
      item_document_name:  l.description,
      quantity:            l.quantity,
      rate:                l.rate,
      amount:              l.amount,
      unit:                l.selected_unit_id,
    })),
  };
}

function determineFailureStage(message: string): "extract" | "validate" | "process" {
  const lower = message.toLowerCase();
  if (lower.includes("extract") || lower.includes("ai ") || lower.includes("returned zero") || lower.includes("valid json")) return "extract";
  if (lower.includes("netsuite") || lower.includes("restlet") || lower.includes("process")) return "process";
  return "validate";
}
