import { redirect } from "next/navigation";
import { getTenantSession } from "@/lib/auth/jwt";
import { requireApAutomation } from "@/lib/products";
import { isFeatureEnabled } from "@/lib/features";
import { canUploadDocuments } from "@/lib/ap/upload-access";
import { db } from "@/lib/db";
import { historyDocuments, subsidiaries } from "@/db/schema";
import { and, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { isInvoiceFormat } from "@/lib/subsidiaries/invoice-format";
import { DocumentsView, type DocListRow, type DocTab } from "./view";

const PAGE_SIZE = 50;

/** Pestañas de la lista: clave de URL → estados que agrupa. */
type DocStatus = (typeof historyDocuments.status.enumValues)[number];
type DocType = (typeof historyDocuments.documentType.enumValues)[number];

const TABS: Record<Exclude<DocTab, "all">, DocStatus[]> = {
  review:           ["review"],
  pending_approval: ["pending_approval"],
  awaiting_receipt: ["awaiting_receipt"],
  reading:          ["uploaded", "extracting", "processing", "approved"],
  completed:        ["completed"],
  failed:           ["failed"],
};
const TYPES = new Set<string>(["invoice", "xml_cfdi", "purchase_order"]);

function country(locale: string | null): string | null {
  const m = locale?.match(/-([A-Za-z]{2})$/);
  return m ? m[1].toUpperCase() : null;
}

export default async function DocumentsPage({ searchParams }: {
  searchParams: Promise<{ status?: string; q?: string; type?: string; sub?: string; page?: string; upload?: string }>;
}) {
  const sp = await searchParams;
  const session = await getTenantSession({ area: "documents" });
  if (!session) redirect("/login");
  await requireApAutomation(session.orgId);

  const tab: DocTab = sp.status && sp.status in TABS ? (sp.status as DocTab) : "all";
  const q = (sp.q ?? "").trim().slice(0, 80);
  const type = sp.type && TYPES.has(sp.type) ? sp.type : "";
  const page = Math.max(1, Math.floor(Number(sp.page) || 1));

  const subs = await db.query.subsidiaries.findMany({
    where: eq(subsidiaries.organizationId, session.orgId),
    columns: { id: true, name: true, locale: true, invoiceFormat: true, isActive: true },
    orderBy: [subsidiaries.name],
  });
  const sub = sp.sub && subs.some((s) => s.id === sp.sub) ? sp.sub : "";

  // Filtros comunes (sin el de estado): sirven para la lista y para los conteos de las pestañas.
  const base: SQL[] = [eq(historyDocuments.organizationId, session.orgId)];
  if (type) base.push(eq(historyDocuments.documentType, type as DocType));
  if (sub) base.push(eq(historyDocuments.subsidiaryId, sub));
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    base.push(or(ilike(historyDocuments.vendor, like), ilike(historyDocuments.numDoc, like))!);
  }
  const where = tab === "all" ? and(...base) : and(...base, inArray(historyDocuments.status, TABS[tab]));

  let rows: DocListRow[] = [];
  let counts: Record<string, number> = {};
  let total = 0;
  try {
    const [list, byStatus] = await Promise.all([
      db.select({
        id: historyDocuments.id, documentType: historyDocuments.documentType, status: historyDocuments.status,
        vendor: historyDocuments.vendor, numDoc: historyDocuments.numDoc, total: historyDocuments.total,
        createdAt: historyDocuments.createdAt, approvedBy: historyDocuments.approvedBy, errorMessage: historyDocuments.errorMessage,
        poInternalId: historyDocuments.poInternalId,
        // Número de OC leído del JSON sin cargar la columna pesada `products`.
        poTranid: sql<string | null>`(${historyDocuments.products}->'ap_checks'->'po'->'comparison'->>'poTranid')`,
      }).from(historyDocuments).where(where)
        .orderBy(desc(historyDocuments.createdAt))
        .limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE),
      db.select({ status: historyDocuments.status, n: sql<number>`count(*)::int` })
        .from(historyDocuments).where(and(...base)).groupBy(historyDocuments.status),
    ]);
    const byKey = new Map(byStatus.map((r) => [r.status, Number(r.n)]));
    counts = Object.fromEntries(Object.entries(TABS).map(([k, sts]) => [k, sts.reduce((n, st) => n + (byKey.get(st) ?? 0), 0)]));
    counts.all = [...byKey.values()].reduce((s, n) => s + n, 0);
    total = counts[tab] ?? 0;
    rows = list.map((r) => ({
      id: r.id, documentType: r.documentType, status: r.status, vendor: r.vendor, numDoc: r.numDoc,
      total: r.total != null ? Number(r.total) : null,
      createdAt: r.createdAt.toISOString(),
      auto: r.status === "completed" && !r.approvedBy,
      reason: r.errorMessage,
      po: r.poTranid ?? (r.poInternalId ? `#${r.poInternalId}` : null),
    }));
  } catch (err) {
    console.error("[documents]", err);
  }

  const [canUpload, bulkEnabled, exportEnabled] = await Promise.all([
    canUploadDocuments(session),
    isFeatureEnabled(session.orgId, "bulk_upload"),
    isFeatureEnabled(session.orgId, "data_export"),
  ]);

  return (
    <DocumentsView
      rows={rows}
      counts={counts}
      total={total}
      page={page}
      pageSize={PAGE_SIZE}
      filters={{ tab, q, type, sub }}
      subsidiaries={subs.map((s) => ({ id: s.id, name: s.name }))}
      uploadSubsidiaries={subs.filter((s) => s.isActive).map((s) => ({
        id: s.id, name: s.name, country: country(s.locale),
        invoiceFormat: isInvoiceFormat(s.invoiceFormat) ? s.invoiceFormat : "pdf",
      }))}
      canUpload={canUpload}
      bulkEnabled={bulkEnabled}
      exportEnabled={exportEnabled}
      openUpload={sp.upload === "1" && canUpload}
    />
  );
}
