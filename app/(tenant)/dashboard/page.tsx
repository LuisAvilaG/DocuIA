import { redirect } from "next/navigation";
import { getTenantSession } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import {
  usageDaily, historyDocuments, exceptionQueue, itemMappings, subsidiaries,
} from "@/db/schema";
import { and, eq, gte, desc, sql } from "drizzle-orm";
import {
  FileText, AlertTriangle, Clock, CheckCircle2, XCircle, Loader2,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

const STATUS_META: Record<string, {
  label: string;
  badge: string;
  icon: React.ElementType;
}> = {
  uploaded:         { label: "Subido",      badge: "bg-secondary text-muted-foreground",  icon: Clock },
  extracting:       { label: "Extrayendo",  badge: "bg-warning/10 text-warning",          icon: Loader2 },
  review:           { label: "Revisión",    badge: "bg-warning/10 text-warning",          icon: Clock },
  pending_approval: { label: "Aprobación",  badge: "bg-warning/10 text-warning",          icon: Clock },
  approved:         { label: "Aprobado",    badge: "bg-primary/10 text-primary",          icon: CheckCircle2 },
  processing:       { label: "Procesando",  badge: "bg-warning/10 text-warning",          icon: Loader2 },
  completed:        { label: "Completado",  badge: "bg-success/10 text-success",          icon: CheckCircle2 },
  failed:           { label: "Error",       badge: "bg-destructive/10 text-destructive",  icon: XCircle },
};

const DOC_TYPE_LABELS: Record<string, string> = {
  invoice: "Factura", purchase_order: "OC", xml_cfdi: "CFDI",
};

function relativeDate(date: Date): string {
  const diff = Math.floor((Date.now() - date.getTime()) / 60000);
  if (diff < 1)  return "ahora";
  if (diff < 60) return `hace ${diff} min`;
  const h = Math.floor(diff / 60);
  if (h < 24) return `hace ${h}h`;
  const d = Math.floor(h / 24);
  if (d === 1) return "ayer";
  return `hace ${d} días`;
}

async function getDashboardData(orgId: string) {
  try {
    const monthStart = new Date().toISOString().slice(0, 7) + "-01";

    const [usageRow, exceptionsCount, mappingsCount, recentDocs] =
      await Promise.all([
        db
          .select({
            docs:    sql<number>`coalesce(sum(${usageDaily.docsProcessed}), 0)::int`,
            primary: sql<number>`coalesce(sum(${usageDaily.aiPrimaryCalls}), 0)::int`,
            fallback:sql<number>`coalesce(sum(${usageDaily.aiFallbackCalls}), 0)::int`,
          })
          .from(usageDaily)
          .where(and(eq(usageDaily.organizationId, orgId), gte(usageDaily.date, monthStart))),

        db
          .select({ count: sql<number>`count(*)::int` })
          .from(exceptionQueue)
          .where(and(
            eq(exceptionQueue.organizationId, orgId),
            eq(exceptionQueue.status, "pending"),
          )),

        db
          .select({
            count: sql<number>`(
              select count(*) from item_mappings im
              join subsidiaries s on s.id = im.subsidiary_id
              where s.organization_id = ${orgId}
            )::int`,
          })
          .from(sql`(select 1) _t`),

        db.query.historyDocuments.findMany({
          where: eq(historyDocuments.organizationId, orgId),
          orderBy: [desc(historyDocuments.createdAt)],
          limit: 8,
        }),
      ]);

    const u = usageRow[0];

    return {
      docsThisMonth:   Number(u?.docs ?? 0),
      exceptionsCount: Number(exceptionsCount[0]?.count ?? 0),
      mappingsCount:   Number(mappingsCount[0]?.count ?? 0),
      recentDocs,
    };
  } catch (err) {
    console.error("[tenant-dashboard]", err);
    return { docsThisMonth: 0, exceptionsCount: 0, mappingsCount: 0, recentDocs: [] };
  }
}

export default async function TenantDashboardPage() {
  const session = await getTenantSession();
  if (!session) redirect("/login");

  const data = await getDashboardData(session.orgId);
  const hour = new Date().getHours();
  const greeting = hour < 13 ? "Buenos días" : hour < 20 ? "Buenas tardes" : "Buenas noches";
  const hasExceptions = data.exceptionsCount > 0;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Topbar */}
      <div className="h-14 border-b border-border px-6 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-sm font-semibold tracking-[-0.01em] text-foreground">{greeting}</h1>
          <p className="text-xs text-muted-foreground">{session.email}</p>
        </div>
        <p className="text-[0.6875rem] text-muted-foreground tabular-nums">
          {new Date().toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" })}
        </p>
      </div>

      {/* Franja de métricas — sin card, directo sobre el canvas */}
      <div className="grid grid-cols-3 border-b border-border shrink-0">
        <div className="px-6 py-5 border-r border-border">
          <p className="text-[0.6875rem] font-medium text-muted-foreground uppercase tracking-[0.06em]">
            Docs este mes
          </p>
          <p className="text-[1.5rem] font-semibold tracking-[-0.02em] tabular-nums text-foreground mt-2">
            {data.docsThisMonth.toLocaleString("es-MX")}
          </p>
          <p className="text-[0.6875rem] text-muted-foreground mt-1">procesados</p>
        </div>

        <div className="px-6 py-5 border-r border-border">
          <p className="text-[0.6875rem] font-medium text-muted-foreground uppercase tracking-[0.06em]">
            Excepciones
          </p>
          <p className={cn(
            "text-[1.5rem] font-semibold tracking-[-0.02em] tabular-nums mt-2",
            hasExceptions ? "text-warning" : "text-foreground"
          )}>
            {data.exceptionsCount}
          </p>
          <p className="text-[0.6875rem] text-muted-foreground mt-1">
            {hasExceptions ? (
              <Link href="/exceptions" className="text-warning hover:text-warning/80 transition-colors">
                revisar ahora →
              </Link>
            ) : "sin pendientes"}
          </p>
        </div>

        <div className="px-6 py-5">
          <p className="text-[0.6875rem] font-medium text-muted-foreground uppercase tracking-[0.06em]">
            Mapeos
          </p>
          <p className="text-[1.5rem] font-semibold tracking-[-0.02em] tabular-nums text-foreground mt-2">
            {data.mappingsCount.toLocaleString("es-MX")}
          </p>
          <p className="text-[0.6875rem] text-muted-foreground mt-1">confirmados</p>
        </div>
      </div>

      {/* Contenido */}
      <div className="flex-1 p-6 space-y-5 overflow-auto">

        {/* Documentos recientes */}
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold tracking-[-0.01em] text-foreground">Documentos recientes</h2>
              <p className="text-[0.6875rem] text-muted-foreground mt-0.5">Últimos documentos procesados</p>
            </div>
            <div className="flex items-center gap-3">
              <Link
                href="/history"
                className="text-xs text-muted-foreground hover:text-foreground transition-colors duration-[120ms]"
              >
                Ver historial →
              </Link>
              <Link
                href="/workflow"
                className="inline-flex items-center gap-1.5 bg-primary hover:bg-[oklch(0.42_0.15_182)] text-primary-foreground text-xs font-medium px-3 py-[7px] rounded-md shadow-[0_1px_3px_oklch(0.48_0.15_182_/_0.3)] hover:shadow-[0_3px_8px_oklch(0.48_0.15_182_/_0.3)] hover:-translate-y-px active:translate-y-0 transition-all duration-[120ms]"
              >
                <FileText className="w-3 h-3" />
                Subir documento
              </Link>
            </div>
          </div>

          {data.recentDocs.length === 0 ? (
            <div className="py-14 flex flex-col items-center justify-center text-center">
              <p className="text-sm font-medium text-foreground">Sin documentos aún</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                Sube tu primer documento desde Workflow para comenzar
              </p>
              <Link
                href="/workflow"
                className="mt-3 text-xs text-primary hover:text-[oklch(0.42_0.15_182)] transition-colors"
              >
                Ir a Workflow →
              </Link>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  {["Tipo", "Proveedor / Num. Doc", "Total", "Estado", "Fecha"].map(h => (
                    <th
                      key={h}
                      className="px-5 py-2.5 text-left text-[0.6875rem] font-medium text-muted-foreground uppercase tracking-[0.06em]"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.recentDocs.map(doc => {
                  const meta = STATUS_META[doc.status] ?? STATUS_META.uploaded;
                  const Icon = meta.icon;
                  return (
                    <tr key={doc.id} className="hover:bg-accent/40 transition-colors duration-[120ms]">
                      <td className="px-5 py-3">
                        <span className="inline-flex items-center text-[0.6875rem] font-medium bg-secondary text-muted-foreground px-2 py-0.5 rounded-sm">
                          {DOC_TYPE_LABELS[doc.documentType] ?? doc.documentType}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <p className="text-xs font-medium text-foreground">{doc.vendor ?? "—"}</p>
                        <p className="text-[0.6875rem] text-muted-foreground mt-0.5">{doc.numDoc ?? "—"}</p>
                      </td>
                      <td className="px-5 py-3 text-xs text-foreground tabular-nums">
                        {doc.total
                          ? `$${Number(doc.total).toLocaleString("es-MX", { minimumFractionDigits: 2 })}`
                          : "—"}
                      </td>
                      <td className="px-5 py-3">
                        <span className={cn(
                          "inline-flex items-center gap-1.5 text-[0.6875rem] font-medium px-2 py-0.5 rounded-sm",
                          meta.badge
                        )}>
                          <Icon className="w-3 h-3 shrink-0" />
                          {meta.label}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-[0.6875rem] text-muted-foreground tabular-nums">
                        {relativeDate(doc.createdAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Alerta excepciones */}
        {hasExceptions && (
          <div className="bg-warning/8 border border-warning/20 rounded-xl p-4 flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-warning mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">
                {data.exceptionsCount} excepción{data.exceptionsCount > 1 ? "es" : ""} pendiente{data.exceptionsCount > 1 ? "s" : ""}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Hay documentos que requieren revisión manual.
              </p>
            </div>
            <Link
              href="/exceptions"
              className="text-xs text-warning hover:text-warning/80 transition-colors font-medium shrink-0"
            >
              Revisar →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
