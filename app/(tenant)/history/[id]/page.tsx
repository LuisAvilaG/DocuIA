import { notFound, redirect } from "next/navigation";
import { getTenantSession } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { historyDocuments, nsConnections, organizations } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  ChevronLeft, FileText, CheckCircle2, XCircle,
  Clock, Loader2, ExternalLink,
} from "lucide-react";
import { ReviewClient } from "./review-client";
import { PendingApprovalClient } from "./pending-approval-client";
import { DocPreview } from "./doc-preview-lazy";
import { isFeatureEnabled } from "@/lib/features";

import { DOC_STATUS } from "@/lib/status-config";

const STATUS_META: Record<string, { label: string; color: string; bg: string; borderColor: string }> = {
  uploaded:         { ...DOC_STATUS.uploaded,         borderColor: "border-border" },
  extracting:       { ...DOC_STATUS.extracting,       borderColor: "border-warning/20" },
  review:           { ...DOC_STATUS.review,           borderColor: "border-warning/20" },
  pending_approval: { ...DOC_STATUS.pending_approval, borderColor: "border-warning/20" },
  approved:         { ...DOC_STATUS.approved,         borderColor: "border-primary/20" },
  processing:       { ...DOC_STATUS.processing,       borderColor: "border-warning/20" },
  completed:        { ...DOC_STATUS.completed,        borderColor: "border-success/20" },
  failed:           { ...DOC_STATUS.failed,           borderColor: "border-destructive/20" },
};

const DOC_LABELS: Record<string, string> = {
  invoice: "Factura", purchase_order: "Orden de compra", xml_cfdi: "CFDI XML",
};

interface Product {
  description?: string;
  quantity?: number;
  unitPrice?: number;
  total?: number;
  nsItemId?: string;
  unit?: string;
}

export default async function HistoryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getTenantSession();
  if (!session) redirect("/login");

  const { id } = await params;
  const docId = parseInt(id, 10);
  if (isNaN(docId)) notFound();

  let doc;
  try {
    doc = await db.query.historyDocuments.findFirst({
      where: and(
        eq(historyDocuments.id, docId),
        eq(historyDocuments.organizationId, session.orgId),
      ),
    });
  } catch {
    notFound();
  }

  if (!doc) notFound();

  // Build NS record URL if not stored
  let nsRecordUrl = doc.urlNetsuite ?? null;
  if (!nsRecordUrl && doc.netsuiteDocId) {
    try {
      const org = await db.query.organizations.findFirst({ where: eq(organizations.id, session.orgId) });
      const env = (org?.activeNsEnvironment ?? "production") as "sandbox" | "production";
      const conn = await db.query.nsConnections.findFirst({
        where: and(eq(nsConnections.organizationId, session.orgId), eq(nsConnections.environment, env)),
        columns: { accountId: true },
      });
      if (conn?.accountId) {
        const normalizedId = conn.accountId.replace(/_/g, "-").toLowerCase();
        const type = doc.documentType === "purchase_order" ? "purchord" : "vendbill";
        nsRecordUrl = `https://${normalizedId}.app.netsuite.com/app/accounting/transactions/${type}.nl?id=${doc.netsuiteDocId}`;
      }
    } catch { /* no URL — show without link */ }
  }

  const storageEnabled = await isFeatureEnabled(session.orgId, "document_storage");
  const fileExt = doc.storageKey ? (doc.storageKey.split(".").pop() ?? "").toLowerCase() : "";
  const showDocViewer = storageEnabled && Boolean(doc.storageKey) && Boolean(fileExt);

  if (doc.status === "review") {
    if (!doc.products) notFound();
    const ext = doc.storageKey
      ? (doc.storageKey.split(".").pop() ?? "").toLowerCase()
      : "";
    return (
      <ReviewClient
        docId={doc.id}
        subsidiaryId={doc.subsidiaryId}
        storageKey={doc.storageKey ?? null}
        fileExt={ext}
        payload={doc.products as unknown as Parameters<typeof ReviewClient>[0]["payload"]}
      />
    );
  }

  if (doc.status === "pending_approval") {
    if (!doc.products) notFound();
    const uiPayload = doc.products as Record<string, unknown>;
    const docLines = (uiPayload as any)?.document?.lines ?? [];
    return (
      <PendingApprovalClient
        docId={doc.id}
        vendor={doc.vendor}
        numDoc={doc.numDoc}
        total={doc.total ? String(doc.total) : null}
        docType={doc.documentType}
        isAdmin={session.role === "admin"}
        lines={docLines.map((l: any) => ({
          description:      l.description ?? "",
          quantity:         l.quantity ?? null,
          rate:             l.rate ?? null,
          amount:           l.amount ?? null,
          selected_item_id: l.selected_item_id ?? null,
          selected_unit_id: l.selected_unit_id ?? null,
        }))}
      />
    );
  }

  const meta = STATUS_META[doc.status] ?? STATUS_META.uploaded;
  const products = (doc.products ?? []) as Product[];

  function fmtDate(d: Date) {
    return d.toLocaleDateString("es-MX", {
      day: "2-digit", month: "long", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  }

  const header = (
    <div className="h-14 border-b border-border px-6 flex items-center gap-3 shrink-0">
      <Link href="/history" className="text-muted-foreground hover:text-foreground transition-colors">
        <ChevronLeft className="w-4 h-4" />
      </Link>
      <div className="flex items-center gap-2.5 flex-1">
        <div className="w-7 h-7 rounded-lg bg-secondary border border-border flex items-center justify-center">
          <FileText className="w-3.5 h-3.5 text-muted-foreground" />
        </div>
        <div>
          <h1 className="text-sm font-semibold text-foreground">
            {DOC_LABELS[doc.documentType] ?? doc.documentType} #{doc.id}
          </h1>
          <p className="text-xs text-muted-foreground">{fmtDate(doc.createdAt)}</p>
        </div>
      </div>
      <span className={cn("text-xs font-medium px-2.5 py-1 rounded-full border", meta.bg, meta.color, meta.borderColor)}>
        {meta.label}
      </span>
    </div>
  );

  const completedBanner = doc.status === "completed" && (
    <div className="shrink-0 mx-6 mt-5 rounded-xl border px-5 py-4 flex items-center justify-between gap-4"
      style={{ backgroundColor: "oklch(0.97 0.02 162)", borderColor: "oklch(0.60 0.14 162 / 0.25)" }}>
      <div className="flex items-center gap-3">
        <CheckCircle2 className="w-5 h-5 shrink-0" style={{ color: "oklch(0.52 0.16 162)" }} />
        <div>
          <p className="text-sm font-semibold" style={{ color: "oklch(0.40 0.14 162)" }}>
            {doc.netsuiteDocId ? "Documento procesado en NetSuite" : "Procesado en modo prueba (Dry Run)"}
          </p>
          {doc.netsuiteDocId && (
            <p className="text-xs mt-0.5" style={{ color: "oklch(0.55 0.10 162)" }}>
              ID de transacción: <span className="font-mono font-medium">{doc.netsuiteDocId}</span>
            </p>
          )}
          {!doc.netsuiteDocId && (
            <p className="text-xs mt-0.5" style={{ color: "oklch(0.55 0.10 162)" }}>
              No se creó una transacción real — el modo prueba estaba activo al procesar.
            </p>
          )}
        </div>
      </div>
      {nsRecordUrl && (
        <a
          href={nsRecordUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all"
          style={{
            color: "oklch(0.45 0.14 162)",
            borderColor: "oklch(0.60 0.14 162 / 0.35)",
            backgroundColor: "oklch(0.93 0.04 162 / 0.6)",
          }}
        >
          <ExternalLink className="w-3.5 h-3.5" />
          Ver en NetSuite
        </a>
      )}
    </div>
  );

  const failedBanner = doc.status === "failed" && doc.errorMessage && (
    <div className="shrink-0 mx-6 mt-5 rounded-xl border border-destructive/20 bg-destructive/5 px-5 py-4 flex items-start gap-3">
      <XCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
      <div>
        <p className="text-sm font-semibold text-destructive">Error al procesar en NetSuite</p>
        <p className="text-xs text-muted-foreground font-mono leading-relaxed mt-1">{doc.errorMessage}</p>
      </div>
    </div>
  );

  const sidebar = (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-xl p-4">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-4">
          Estado del proceso
        </h2>
        <div className="space-y-3">
          {[
            { label: "Subido",     done: true, active: doc.status === "uploaded" },
            { label: "Extracción", done: !["uploaded"].includes(doc.status), active: doc.status === "extracting" },
            { label: "Revisión",   done: ["approved","processing","completed"].includes(doc.status), active: ["review","pending_approval"].includes(doc.status) },
            { label: "Procesando", done: doc.status === "completed", active: doc.status === "processing" },
            { label: "Completado", done: doc.status === "completed", active: false },
          ].map(({ label, done, active }) => (
            <div key={label} className="flex items-center gap-3">
              <div className={cn(
                "w-5 h-5 rounded-full flex items-center justify-center shrink-0",
                done ? "bg-success/20 text-success" :
                active ? "bg-primary/20 text-primary" :
                "bg-secondary text-muted-foreground/40"
              )}>
                {done ? <CheckCircle2 className="w-3 h-3" /> :
                 active ? <Loader2 className="w-3 h-3 animate-spin" /> :
                 <Clock className="w-3 h-3" />}
              </div>
              <span className={cn(
                "text-xs",
                done ? "text-foreground font-medium" :
                active ? "text-primary font-medium" :
                "text-muted-foreground"
              )}>
                {label}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl p-4">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
          Metadata
        </h2>
        <div className="space-y-2.5 text-xs">
          <div className="flex justify-between">
            <span className="text-muted-foreground">ID</span>
            <span className="text-foreground font-mono">{doc.id}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Creado</span>
            <span className="text-foreground">{doc.createdAt.toLocaleDateString("es-MX")}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Actualizado</span>
            <span className="text-foreground">{doc.updatedAt.toLocaleDateString("es-MX")}</span>
          </div>
          {doc.netsuiteDocId && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">NS Doc ID</span>
              <span className="text-primary font-mono">{doc.netsuiteDocId}</span>
            </div>
          )}
          {doc.storageKey && (
            <div>
              <span className="text-muted-foreground block mb-1">Archivo</span>
              <span className="text-foreground font-mono text-[10px] break-all">{doc.storageKey}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const mainContent = (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-xl p-5">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-4">
          Datos del documento
        </h2>
        <div className="grid grid-cols-2 gap-4">
          {[
            { label: "Proveedor", value: doc.vendor ?? "—" },
            { label: "Num. Doc",  value: doc.numDoc ?? "—" },
            { label: "Total",     value: doc.total ? `$${Number(doc.total).toLocaleString("es-MX", { minimumFractionDigits: 2 })}` : "—" },
            { label: "Tipo",      value: DOC_LABELS[doc.documentType] ?? doc.documentType },
          ].map(({ label, value }) => (
            <div key={label}>
              <p className="text-[11px] text-muted-foreground mb-0.5">{label}</p>
              <p className="text-sm font-medium text-foreground">{value}</p>
            </div>
          ))}
        </div>
      </div>

      {products.length > 0 && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-sm font-medium text-foreground">
              Líneas del documento ({products.length})
            </h2>
          </div>
          <div className="overflow-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-secondary/30">
                  {["Descripción", "Cant.", "Unidad", "P. Unitario", "Total", "Item NS"].map(h => (
                    <th key={h} className="px-3 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {products.map((p, i) => (
                  <tr key={i} className="hover:bg-accent/20 transition-colors">
                    <td className="px-3 py-2.5 text-foreground max-w-[250px]">
                      <p className="truncate">{p.description ?? "—"}</p>
                    </td>
                    <td className="px-3 py-2.5 tabular-nums text-foreground">{p.quantity ?? "—"}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{p.unit ?? "—"}</td>
                    <td className="px-3 py-2.5 tabular-nums text-foreground">
                      {p.unitPrice != null
                        ? `$${p.unitPrice.toLocaleString("es-MX", { minimumFractionDigits: 2 })}`
                        : "—"}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums font-medium text-foreground">
                      {p.total != null
                        ? `$${p.total.toLocaleString("es-MX", { minimumFractionDigits: 2 })}`
                        : "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      {p.nsItemId ? (
                        <span className="text-primary bg-primary/10 px-1.5 py-0.5 rounded font-mono text-[10px]">
                          {p.nsItemId}
                        </span>
                      ) : (
                        <span className="text-warning bg-warning/10 px-1.5 py-0.5 rounded text-[10px]">
                          Sin mapear
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {products.length === 0 && (
        <div className="bg-card border border-border rounded-xl p-8 text-center">
          <p className="text-sm text-muted-foreground">Sin líneas de detalle extraídas</p>
        </div>
      )}
    </div>
  );

  // ── Layout with document viewer (document_storage feature enabled) ──────────
  if (showDocViewer) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        {header}
        <div className="flex-1 flex overflow-hidden min-h-0">
          {/* Document viewer panel */}
          <div className="w-[44%] shrink-0 flex flex-col overflow-hidden">
            <DocPreview docId={doc.id} activeBbox={undefined} fileExt={fileExt} />
          </div>

          {/* Details panel */}
          <div className="flex-1 flex flex-col overflow-auto">
            {completedBanner}
            {failedBanner}
            <div className="p-6 grid grid-cols-1 xl:grid-cols-3 gap-6">
              <div className="xl:col-span-2">{mainContent}</div>
              <div>{sidebar}</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Default layout (no document viewer) ─────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col overflow-auto">
      {header}
      {completedBanner}
      {failedBanner}
      <div className="flex-1 p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">{mainContent}</div>
        <div>{sidebar}</div>
      </div>
    </div>
  );
}
