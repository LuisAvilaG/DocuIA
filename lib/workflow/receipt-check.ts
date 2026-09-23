// Documents in "awaiting_receipt" are re-checked against the ERP until the
// goods are received (then posted, or sent for approval when the workflow asks
// for it) or the maximum wait expires.

import { db } from "@/lib/db";
import { exceptionQueue, historyDocuments } from "@/db/schema";
import { and, asc, eq, lte } from "drizzle-orm";
import { storedDraft } from "./ns-payload";
import { gateDraftAgainstPo, loadFeatureFlags, type ApChecks } from "./ap-checks";
import { postClaimedDocument } from "./post-draft";

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

export async function recheckAwaitingReceipt(doc: HistoryDocument, approvedBy: string | null = null): Promise<ReceiptCheckResult> {
  if (doc.status !== "awaiting_receipt") return { status: "skipped", reason: "El documento ya no espera recepción" };
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
  const previous = (productsOf(doc).ap_checks ?? null) as ApChecks | null;
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
    await moveTo(doc, gate.outcome.kind === "needs_approval" || gate.outcome.kind === "blocked" ? "pending_approval" : "review", gate.outcome.reason, checks);
    return { status: "pending_approval", reason: gate.outcome.reason };
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
  const result = await postClaimedDocument({ doc: claimed[0], draft, approvedBy, revertTo: "review" });
  return result.ok ? { status: "completed" } : { status: "review", reason: result.error };
}

/** Cron entry point: due documents across all organizations, oldest first. */
export async function runReceiptChecks(limit = 50): Promise<{ checked: number; completed: number; waiting: number; moved: number }> {
  const due = await db.query.historyDocuments.findMany({
    where: and(eq(historyDocuments.status, "awaiting_receipt"), lte(historyDocuments.nextReceiptCheckAt, new Date())),
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
