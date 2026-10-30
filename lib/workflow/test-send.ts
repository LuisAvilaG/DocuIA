// "Envío de prueba en sandbox": posts a document to the ERP sandbox even when
// it already exists there, using a fresh external id and a suffixed document
// number so the RESTlet's duplicate checks let it through. Never touches the
// document's own status and is refused outright outside sandbox.
import { db } from "@/lib/db";
import { historyDocuments, organizations, subsidiaries } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getFeature, isFeatureEnabled } from "@/lib/features";
import { resolveCustomFormId } from "@/lib/netsuite/custom-forms";
import { processInNetSuite } from "./process-ns";
import { buildNsPayload, type NsDraft, type PoConfig } from "./ns-payload";
import { erpExtras } from "./erp-extras";

type HistoryDocument = typeof historyDocuments.$inferSelect;

export interface TestSend {
  at: string;
  by: string | null;
  seq: number;
  externalId: string;
  documentNumber: string | null;
  internalId: string | null;
  recordUrl: string | null;
}

export function testSendsOf(products: unknown): TestSend[] {
  if (!products || typeof products !== "object" || Array.isArray(products)) return [];
  const list = (products as { test_sends?: unknown }).test_sends;
  return Array.isArray(list) ? (list as TestSend[]) : [];
}

/** Whether the tenant may send test documents right now (feature + sandbox). */
export async function sandboxTestSendAvailable(orgId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const [enabled, org] = await Promise.all([
    isFeatureEnabled(orgId, "sandbox_test_send"),
    db.query.organizations.findFirst({ where: eq(organizations.id, orgId), columns: { activeNsEnvironment: true } }),
  ]);
  if (!enabled) return { ok: false, reason: "El envío de prueba no está habilitado para tu organización" };
  if (org?.activeNsEnvironment !== "sandbox") return { ok: false, reason: "El envío de prueba solo está disponible mientras el ERP activo sea sandbox" };
  return { ok: true };
}

export async function sendTestToSandbox(opts: { doc: HistoryDocument; draft: NsDraft; userId: string | null }): Promise<TestSend> {
  const { doc, draft } = opts;
  const orgId = doc.organizationId;
  const gate = await sandboxTestSendAvailable(orgId);
  if (!gate.ok) throw new Error(gate.reason);

  const [formsFeat, poFeature, sub] = await Promise.all([
    getFeature(orgId, "custom_netsuite_forms"),
    getFeature(orgId, "po_processing"),
    db.query.subsidiaries.findFirst({
      where: and(eq(subsidiaries.id, doc.subsidiaryId), eq(subsidiaries.organizationId, orgId)),
      columns: { nsSubsidiaryId: true },
    }),
  ]);
  if (!sub) throw new Error("Subsidiaria no encontrada");

  const previous = testSendsOf(doc.products);
  const seq = previous.length + 1;
  const stamp = Date.now().toString(36);
  const externalId = `docuia-test:${orgId}:${doc.id}:${seq}-${stamp}`;
  const suffix = `-PRUEBA${seq}`;
  const baseNumber = draft.invoiceNumber ?? doc.numDoc ?? `DOC${doc.id}`;
  const documentNumber = `${baseNumber}${suffix}`.slice(0, 45);
  const customFormId = formsFeat.isEnabled ? resolveCustomFormId(formsFeat.config, doc.subsidiaryId, doc.documentType) : "";

  const payload = {
    ...buildNsPayload({ ...draft, invoiceNumber: documentNumber }, {
      organizationId: orgId,
      documentId:     doc.id,
      documentType:   doc.documentType,
      nsSubsidiaryId: sub.nsSubsidiaryId,
      dryRun:         false,
      customFormId:   customFormId || undefined,
      poConfig:       poFeature.config as PoConfig,
    }),
    ...(await erpExtras(doc)),
    external_id: externalId,
    memo: `Envío de prueba DocuIA #${seq} del documento ${doc.id}`,
  };

  const result = await processInNetSuite(orgId, payload);
  if (result.nsResponse?.already_exists) {
    throw new Error("El ERP reportó la transacción como existente pese al id de prueba. Actualiza el script de proceso del ERP.");
  }
  const entry: TestSend = {
    at: new Date().toISOString(), by: opts.userId, seq, externalId, documentNumber,
    internalId: result.internalId, recordUrl: result.recordUrl,
  };
  // Keep the record on the document without touching its workflow state.
  const base = doc.products && typeof doc.products === "object" && !Array.isArray(doc.products)
    ? (doc.products as Record<string, unknown>) : null;
  if (base) {
    await db.update(historyDocuments)
      .set({ products: { ...base, test_sends: [...previous, entry] } as unknown, updatedAt: new Date() })
      .where(eq(historyDocuments.id, doc.id));
  }
  return entry;
}
