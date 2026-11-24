"use client";

import { useInBrowser } from "@/lib/use-in-browser";
import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Download, Search, Upload } from "lucide-react";
import { ApStatusPill, btn, EmptyState, PageFrame, ViewTabs } from "@/components/kit";
import { friendlyError } from "@/lib/ap/friendly-error";
import { UploadDrawer, type UploadSubsidiary } from "./upload-drawer";

export type DocTab = "all" | "review" | "pending_approval" | "awaiting_receipt" | "reading" | "completed" | "failed";

export interface DocListRow {
  id: number; documentType: string; status: string; vendor: string | null; numDoc: string | null;
  total: number | null; createdAt: string; auto: boolean; reason: string | null; po: string | null; qa: boolean;
}

const TAB_LABEL: Record<DocTab, string> = {
  all: "Todos", review: "Por revisar", pending_approval: "Por aprobar", awaiting_receipt: "Esperando recepción",
  reading: "Leyendo", completed: "En el ERP", failed: "Con error",
};
const TYPE_LABEL: Record<string, string> = { invoice: "Factura", xml_cfdi: "CFDI", purchase_order: "Orden de compra" };

const short = (s: string | null, max = 40) => (s && s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

function when(iso: string): string {
  const d = new Date(iso);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const time = d.toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" });
  if (d >= today) return `Hoy ${time}`;
  if (d >= new Date(today.getTime() - 86_400_000)) return `Ayer ${time}`;
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

function detail(r: DocListRow): string | null {
  if (r.status === "completed") return r.auto ? "automática" : null;
  if (r.status === "review" || r.status === "failed" || r.status === "pending_approval") return short(friendlyError(r.reason));
  return null;
}

export function DocumentsView({
  rows, counts, total, page, pageSize, filters, subsidiaries, uploadSubsidiaries, canUpload, bulkEnabled, exportEnabled, openUpload,
}: {
  rows: DocListRow[];
  counts: Record<string, number>;
  total: number;
  page: number;
  pageSize: number;
  filters: { tab: DocTab; q: string; type: string; sub: string };
  subsidiaries: { id: string; name: string }[];
  uploadSubsidiaries: UploadSubsidiary[];
  canUpload: boolean;
  bulkEnabled: boolean;
  exportEnabled: boolean;
  openUpload: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();
  const inBrowser = useInBrowser();
  const [uploading, setUploading] = useState(openUpload);
  const [q, setQ] = useState(filters.q);

  const href = (next: Partial<typeof filters> & { page?: number }) => {
    const f = { ...filters, ...next };
    const p = new URLSearchParams();
    if (f.tab !== "all") p.set("status", f.tab);
    if (f.q) p.set("q", f.q);
    if (f.type) p.set("type", f.type);
    if (f.sub) p.set("sub", f.sub);
    if (next.page && next.page > 1) p.set("page", String(next.page));
    const s = p.toString();
    return s ? `${pathname}?${s}` : pathname;
  };
  const go = (next: Partial<typeof filters>) => startTransition(() => router.replace(href(next), { scroll: false }));

  // Búsqueda con espera corta para no consultar en cada tecla.
  useEffect(() => {
    if (q.trim() === filters.q) return;
    const t = setTimeout(() => go({ q: q.trim() }), 350);
    return () => clearTimeout(t);
    // Also when the filters change: a timer started before "Limpiar" or a tab
    // change would navigate with the filters it was created with and bring them back.
  }, [q, filters.q, filters.type, filters.sub, filters.tab]); // eslint-disable-line react-hooks/exhaustive-deps

  function closeUpload() {
    setUploading(false);
    if (openUpload) router.replace(href({}), { scroll: false });
  }

  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const filtered = Boolean(filters.q || filters.type || filters.sub || filters.tab !== "all");

  return (
    <PageFrame>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.025em]">Documentos</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">Facturas, órdenes de compra y CFDI que pasaron por DocuIA.</p>
        </div>
        <div className="flex gap-2">
          {exportEnabled && <a href="/api/v1/history/export" className={btn("secondary")}><Download />Exportar CSV</a>}
          {canUpload && <button type="button" className={btn("primary")} onClick={() => setUploading(true)}><Upload />Subir documentos</button>}
        </div>
      </div>

      <ViewTabs className="mt-6" items={(Object.keys(TAB_LABEL) as DocTab[])
        .filter((k) => k === "all" || k === filters.tab || (counts[k] ?? 0) > 0)
        .map((k) => ({ key: k, label: TAB_LABEL[k], count: counts[k] ?? 0, href: href({ tab: k }), active: filters.tab === k }))} />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <label className="relative w-full sm:w-[300px]">
          <span className="sr-only">Buscar</span>
          <Search aria-hidden className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar proveedor o número"
            className="min-h-10 w-full rounded-lg border border-[#D6D2C8] bg-white pl-9 pr-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" />
        </label>
        <select aria-label="Tipo" value={filters.type} onChange={(e) => go({ type: e.target.value })}
          className="min-h-10 rounded-lg border border-[#D6D2C8] bg-white px-3 text-sm">
          <option value="">Todos los tipos</option>
          {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {subsidiaries.length > 1 && (
          <select aria-label="Subsidiaria" value={filters.sub} onChange={(e) => go({ sub: e.target.value })}
            className="min-h-10 rounded-lg border border-[#D6D2C8] bg-white px-3 text-sm">
            <option value="">Todas las subsidiarias</option>
            {subsidiaries.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        {(filters.q || filters.type || filters.sub) && (
          <button type="button" className={btn("text", "sm")} onClick={() => { setQ(""); go({ q: "", type: "", sub: "" }); }}>Limpiar</button>
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState className="mt-3.5" title={filtered ? "Nada coincide con estos filtros" : "Todavía no hay documentos"}
          actions={!filtered && canUpload ? <button type="button" className={btn("primary")} onClick={() => setUploading(true)}><Upload />Subir documentos</button> : undefined}>
          {filtered ? "Prueba con otra pestaña o búsqueda." : "Las facturas y órdenes que lleguen a DocuIA aparecerán aquí."}
        </EmptyState>
      ) : (
        <>
          <div className="mt-3.5 overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full text-[13.5px]">
              <thead>
                <tr className="border-b border-border">
                  {["Fecha", "Documento", "Proveedor", "OC", "Total", "Estado"].map((h) => (
                    <th key={h} scope="col" className={`whitespace-nowrap px-3.5 py-2.5 text-[11.5px] font-semibold uppercase tracking-[0.05em] text-muted-foreground ${h === "Total" ? "text-right" : "text-left"}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-line-soft last:border-0 hover:bg-secondary/30">
                    <td className="whitespace-nowrap px-3.5 py-3 text-muted-foreground">{inBrowser ? when(r.createdAt) : ""}</td>
                    <td className="whitespace-nowrap px-3.5 py-3">
                      <Link href={`/history/${r.id}`} className="font-semibold text-link hover:underline">{r.numDoc ?? `#${r.id}`}</Link>
                      <span className="ml-2 rounded-[5px] bg-tone-mute-bg px-1.5 py-0.5 text-[11.5px] font-semibold text-foreground/70">{TYPE_LABEL[r.documentType] ?? r.documentType}</span>
                      {r.qa && <span title="Llegó durante una ronda del modo QA" className="ml-1.5 rounded-[5px] bg-tone-warn-bg px-1.5 py-0.5 text-[11.5px] font-semibold text-tone-warn">QA</span>}
                    </td>
                    <td className="max-w-[260px] truncate px-3.5 py-3">{r.vendor ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className="whitespace-nowrap px-3.5 py-3">{r.documentType === "purchase_order" ? <span className="text-muted-foreground">—</span> : r.po ?? <span className="text-muted-foreground">Sin OC</span>}</td>
                    <td className="whitespace-nowrap px-3.5 py-3 text-right tabular-nums">{r.total != null ? r.total.toLocaleString("es-MX", { style: "currency", currency: "MXN" }) : "—"}</td>
                    <td className="max-w-[320px] px-3.5 py-3"><ApStatusPill status={r.status} detail={detail(r)} dot /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <span className="text-[12.5px] text-muted-foreground tabular-nums">Mostrando {from.toLocaleString("es-MX")}–{to.toLocaleString("es-MX")} de {total.toLocaleString("es-MX")}{total > pageSize && ` · página ${page} de ${Math.ceil(total / pageSize)}`}</span>
            <span className="flex gap-1.5">
              <PageLink href={page > 1 ? href({ page: page - 1 }) : null}>Anterior</PageLink>
              <PageLink href={to < total ? href({ page: page + 1 }) : null}>Siguiente</PageLink>
            </span>
          </div>
        </>
      )}

      {uploading && (
        <UploadDrawer
          subsidiaries={uploadSubsidiaries}
          bulkEnabled={bulkEnabled}
          onClose={closeUpload}
          onUploaded={() => router.refresh()}
        />
      )}
    </PageFrame>
  );
}

function PageLink({ href, children }: { href: string | null; children: React.ReactNode }) {
  return href
    ? <Link href={href} scroll={false} className={btn("secondary", "sm")}>{children}</Link>
    : <span aria-disabled className={btn("secondary", "sm", "pointer-events-none opacity-50")}>{children}</span>;
}
