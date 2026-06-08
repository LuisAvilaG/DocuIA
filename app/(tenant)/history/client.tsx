"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  Clock, Search, CheckCircle2, XCircle, Loader2,
  FileText, ChevronRight, Filter, Download,
} from "lucide-react";
import { useFeature } from "@/components/providers/feature-provider";
import { DOC_STATUS } from "@/lib/status-config";

const DOC_LABELS: Record<string, string> = {
  invoice: "Factura", purchase_order: "Orden de compra", xml_cfdi: "CFDI XML",
};

interface DocRow {
  id: number; documentType: string; status: string; vendor: string | null;
  numDoc: string | null; total: number | null; createdAt: string; updatedAt: string;
}

export function HistoryTableClient({ docs }: { docs: DocRow[] }) {
  const router = useRouter();
  const dataExport = useFeature("data_export");
  const [search,  setSearch]  = useState("");
  const [status,  setStatus]  = useState("");
  const [docType, setDocType] = useState("");

  const filtered = useMemo(() => {
    return docs.filter(d => {
      if (status  && d.status !== status)       return false;
      if (docType && d.documentType !== docType) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!d.vendor?.toLowerCase().includes(q) && !d.numDoc?.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [docs, search, status, docType]);

  function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString("es-MX", {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="h-14 border-b border-border px-6 flex items-center gap-3 shrink-0">
        <Clock className="w-4 h-4 text-muted-foreground" />
        <div className="flex-1">
          <h1 className="text-sm font-semibold text-foreground">Historial</h1>
          <p className="text-xs text-muted-foreground">
            {docs.length === 200 ? "Mostrando los últimos 200 documentos" : `${docs.length} documentos`}
          </p>
        </div>
        {dataExport && (
          <a
            href="/api/v1/history/export"
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border/60 hover:border-border rounded-lg px-2.5 py-1.5 transition-all"
          >
            <Download className="w-3.5 h-3.5" />
            Exportar CSV
          </a>
        )}
      </div>

      {/* Filters */}
      <div className="px-6 py-3 border-b border-border flex items-center gap-3 shrink-0">
        <div className="relative flex-1 max-w-64">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar proveedor o número..."
            className="w-full bg-secondary/50 border border-border/60 rounded-lg pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/20"
          />
        </div>
        <select
          value={status}
          onChange={e => setStatus(e.target.value)}
          className="bg-secondary/50 border border-border/60 rounded-lg px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary/60"
        >
          <option value="">Todos los estados</option>
          {Object.entries(DOC_STATUS).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <select
          value={docType}
          onChange={e => setDocType(e.target.value)}
          className="bg-secondary/50 border border-border/60 rounded-lg px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary/60"
        >
          <option value="">Todos los tipos</option>
          {Object.entries(DOC_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        {(search || status || docType) && (
          <button
            onClick={() => { setSearch(""); setStatus(""); setDocType(""); }}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors ml-auto"
          >
            Limpiar
          </button>
        )}
        <span className="text-xs text-muted-foreground ml-auto">
          <Filter className="w-3 h-3 inline mr-1" />
          {filtered.length} resultado{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <FileText className="w-8 h-8 text-muted-foreground mb-3" />
            <p className="text-sm font-medium text-foreground">
              {docs.length === 0 ? "Sin documentos procesados" : "Sin resultados"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {docs.length === 0
                ? "Los documentos que proceses aparecerán aquí"
                : "Prueba con otros filtros"}
            </p>
            {docs.length === 0 && (
              <Link href="/workflow" className="mt-4 text-xs text-primary hover:text-primary/80 transition-colors">
                Ir a Workflow →
              </Link>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="sticky top-0 bg-background border-b border-border z-10">
                <tr>
                  {["Fecha", "Tipo", "Proveedor", "Num. Doc", "Total", "Estado", ""].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map(doc => {
                  const meta = DOC_STATUS[doc.status] ?? DOC_STATUS.uploaded;
                  return (
                    <tr key={doc.id} onClick={() => router.push(`/history/${doc.id}`)} className="hover:bg-accent/30 transition-colors cursor-pointer">
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                        {fmtDate(doc.createdAt)}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs bg-secondary/80 border border-border/60 text-muted-foreground px-2 py-0.5 rounded">
                          {DOC_LABELS[doc.documentType] ?? doc.documentType}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs font-medium text-foreground max-w-[180px] truncate">
                        {doc.vendor ?? <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground tabular-nums">
                        {doc.numDoc ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-xs tabular-nums text-foreground">
                        {doc.total !== null
                          ? `$${doc.total.toLocaleString("es-MX", { minimumFractionDigits: 2 })}`
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn("text-xs font-medium", meta.color)}>{meta.label}</span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground/40">
                        <ChevronRight className="w-3.5 h-3.5" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
