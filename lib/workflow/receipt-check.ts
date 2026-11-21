// Documents in "awaiting_receipt" are re-checked against the ERP until the
// goods are received (then posted, or sent for approval when the workflow asks
// for it) or the maximum wait expires.

import { db } from "@/lib/db";
import { exceptionQueue, historyDocuments, organizations } from "@/db/schema";
import { and, asc, eq, inArray, lte } from "drizzle-orm";
import { assignPoLines, storedDraft } from "./ns-payload";
import { gateDraftAgainstPo, loadFeatureFlags, vendorRuleFor, type ApChecks } from "./ap-checks";
import { postClaimedDocument } from "./post-draft";
import { operatingOrganization } from "@/lib/auth/jwt";

type HistoryDocument = typeof historyDocuments.$inferSelect;

export type ReceiptCheckResult =
  | { status: "completed" | "pending_approval" | "review" | "failed"; reason?: string }
  | { status: "awaiting_receipt"; reason: string; nextCheckAt: Date }
  | { status: "skipped"; reason: string };

function productsOf(doc: HistoryDocument): Record<string, unknown> {
  return doc.products && typeof doc.products === "object" ? doc.products as Record<string, unknown> : {};
}

async function moveTo(doc: HistoryDocument, status: "review" | "pending_approval" | "failed", reason: string, extra: Record<string, unknown> = {}) {
  const moved = await db.update(historyDocuments)
    .set({ status, errorMessage: reason, nextReceiptCheckAt: null, products: { ...productsOf(doc), ...extra } as unknown, updatedAt: new Date() })
    .where(and(eq(historyDocuments.id, doc.id), eq(historyDocuments.status, "awaiting_receipt")))
    .returning({ id: historyDocuments.id });
  return moved.length > 0;
}

export async function recheckAwaitingReceipt(doc: HistoryDocument, requestedBy: string | null = null): Promise<ReceiptCheckResult> {
  if (doc.status !== "awaiting_receipt") return { status: "skipped", reason: "El documento ya no espera recepción" };
  // An approver who sent it and was told to wait for the goods already approved it.
  const granted = productsOf(doc).approval_granted_by;
  const approvedBy = requestedBy ?? (typeof granted === "string" ? granted : null);
  const flags = await loadFeatureFlags(doc.organizationId);
  const draft = storedDraft(doc.products);
  if (!draft?.poId) {
    await moveTo(doc, "review", "Sin OC para verificar la recepción");
    return { status: "review", reason: "Sin OC para verificar la recepción" };
  }
  if (!flags.isEnabled("three_way_match")) {
    await moveTo(doc, "review", "La validación con entrada de almacén se desactivó; revisa y envía el documento");
    return { status: "review" };
  }

  const cfg = flags.getConfig("three_way_match");
  const stored = (productsOf(doc).ap_checks ?? null) as ApChecks | null;
  // The rule of the vendor on the draft, which may not be the one read at extraction.
  const vendorRule = flags.isEnabled("vendor_rules") ? await vendorRuleFor(doc.organizationId, doc.subsidiaryId, draft.vendorId, flags) : stored?.vendorRule ?? null;
  const previous: ApChecks | null = stored ? { ...stored, vendorRule } : vendorRule ? { vendorRule, fiscal: null, po: null } : null;
  const gate = await gateDraftAgainstPo({ organizationId: doc.organizationId, draft, invoiceTotal: Number(doc.total ?? 0), storedChecks: previous, flags });
  const checks = previous?.po && gate.comparison
    ? { ap_checks: { ...previous, po: { ...previous.po, comparison: gate.comparison, outcome: gate.outcome } } }
    : {};

  if (gate.error || !gate.outcome) {
    // ERP unreachable: try again at the next check, do not fail the document.
    const nextCheckAt = new Date(Date.now() + Math.max(1, Number(cfg.recheck_hours) || 2) * 3_600_000);
    await db.update(historyDocuments).set({ nextReceiptCheckAt: nextCheckAt, updatedAt: new Date() }).where(eq(historyDocuments.id, doc.id));
    return { status: "awaiting_receipt", reason: gate.error ?? "No se pudo consultar la OC", nextCheckAt };
  }

  if (gate.outcome.kind === "await_receipt") {
    const maxWaitMs = Math.max(1, Number(cfg.max_wait_days) || 15) * 86_400_000;
    const since = doc.awaitingSince ?? doc.updatedAt;
    if (Date.now() - since.getTime() > maxWaitMs) {
      const reason = `La recepción no llegó en ${Math.round(maxWaitMs / 86_400_000)} días: ${gate.outcome.reason}`;
      if (cfg.on_timeout === "exception") {
        if (await moveTo(doc, "failed", reason, checks)) {
          await db.insert(exceptionQueue).values({
            organizationId: doc.organizationId, documentId: doc.id, subsidiaryId: doc.subsidiaryId,
            documentType: doc.documentType, storageKey: doc.storageKey,
            // The retry reads the file type from this name.
            originalFilename: doc.storageKey?.split("/").pop()?.replace(/^\d+-/, "") ?? null,
            failureStage: "validate", failureReason: reason, status: "pending",
          });
        }
        return { status: "failed", reason };
      }
      await moveTo(doc, "review", reason, checks);
      return { status: "review", reason };
    }
    const nextCheckAt = new Date(Date.now() + Math.max(1, Number(cfg.recheck_hours) || 2) * 3_600_000);
    await db.update(historyDocuments)
      .set({ nextReceiptCheckAt: nextCheckAt, errorMessage: gate.outcome.reason, products: { ...productsOf(doc), ...checks } as unknown, updatedAt: new Date() })
      .where(and(eq(historyDocuments.id, doc.id), eq(historyDocuments.status, "awaiting_receipt")));
    return { status: "awaiting_receipt", reason: gate.outcome.reason, nextCheckAt };
  }

  if (gate.outcome.kind !== "ok" && gate.outcome.kind !== "needs_review") {
    // Received, but the PO changed meanwhile (price, quantities): a person decides.
    const to = gate.outcome.kind === "needs_approval" || gate.outcome.kind === "blocked" ? "pending_approval" : "review";
    await moveTo(doc, to, gate.outcome.reason, checks);
    return { status: to, reason: gate.outcome.reason };
  }
  // Lines that are not on the PO need a person. When the pipeline parked the
  // document itself nobody has seen them yet: review, not an automatic post.
  const seenByReviewer = Boolean(approvedBy) || typeof productsOf(doc).approval_requested_by === "string";
  if (gate.outcome.kind === "needs_review" && !seenByReviewer) {
    await moveTo(doc, "review", gate.outcome.reason, checks);
    return { status: "review", reason: gate.outcome.reason };
  }
  if (flags.isEnabled("approval_workflow") && !approvedBy) {
    await moveTo(doc, "pending_approval", "Recepción completa; falta la aprobación", checks);
    return { status: "pending_approval" };
  }

  const claimed = await db.update(historyDocuments)
    .set({ status: "processing", errorMessage: null, updatedAt: new Date() })
    .where(and(eq(historyDocuments.id, doc.id), eq(historyDocuments.status, "awaiting_receipt")))
    .returning();
  if (!claimed.length) return { status: "skipped", reason: "Otro proceso tomó el documento" };
  const toPost = gate.comparison ? { ...draft, lines: assignPoLines(draft.lines, gate.comparison.lines) } : draft;
  const result = await postClaimedDocument({ doc: claimed[0], draft: toPost, approvedBy, revertTo: "review" });
  return result.ok ? { status: "completed" } : { status: "review", reason: result.error };
}

/** Cron entry point: due documents across all organizations, oldest first. */
export async function runReceiptChecks(limit = 50): Promise<{ checked: number; completed: number; waiting: number; moved: number }> {
  const due = await db.query.historyDocuments.findMany({
    where: and(
      eq(historyDocuments.status, "awaiting_receipt"),
      lte(historyDocuments.nextReceiptCheckAt, new Date()),
      // A suspended or deleted client, or an ended trial, must not keep posting to its ERP.
      inArray(historyDocuments.organizationId, db.select({ id: organizations.id }).from(organizations).where(operatingOrganization())),
    ),
    orderBy: [asc(historyDocuments.nextReceiptCheckAt)],
    limit,
  });
  const summary = { checked: 0, completed: 0, waiting: 0, moved: 0 };
  for (const doc of due) {
    try {
      const r = await recheckAwaitingReceipt(doc);
      summary.checked++;
      if (r.status === "completed") summary.completed++;
      else if (r.status === "awaiting_receipt") summary.waiting++;
      else if (r.status !== "skipped") summary.moved++;
    } catch (err) {
      console.error("[receipt-check]", doc.id, err instanceof Error ? err.message : err);
    }
  }
  return summary;
}
