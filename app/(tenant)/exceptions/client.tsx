"use client";

import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  AlertTriangle, Search, CheckCircle2, Clock,
  RotateCcw, FileText, XCircle, Loader2,
} from "lucide-react";

const STATUS_META: Record<string, { label: string; color: string; bg: string; border: string }> = {
  pending:     { label: "Pendiente",   color: "text-warning",          bg: "bg-warning/10",         border: "border-warning/20" },
  in_progress: { label: "En proceso", color: "text-primary",           bg: "bg-primary/10",         border: "border-primary/20" },
  resolved:    { label: "Resuelto",   color: "text-success",           bg: "bg-success/10",         border: "border-success/20" },
  dismissed:   { label: "Descartado", color: "text-muted-foreground",  bg: "bg-muted",              border: "border-border" },
};

const STAGE_META: Record<string, { label: string; color: string }> = {
  extract:  { label: "Extracción", color: "text-destructive" },
  validate: { label: "Validación", color: "text-warning" },
  process:  { label: "Proceso",    color: "text-warning" },
};

const DOC_LABELS: Record<string, string> = {
  invoice: "Factura", purchase_order: "OC", xml_cfdi: "CFDI",
};

interface ExRow {
  id: number; documentType: string | null; originalFilename: string | null;
  failureStage: string; failureReason: string | null; errorCode: string | null;
  status: string; retryCount: number; createdAt: string;
}

export function ExceptionsClient({ exceptions: initial }: { exceptions: ExRow[] }) {
  const [exceptions, setExceptions] = useState(initial);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("pending");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<Record<number, string>>({});

  async function handleRetry(id: number) {
    setLoadingId(id);
    setActionError((p) => ({ ...p, [id]: "" }));
    try {
      const res = await fetch(`/api/v1/exceptions/${id}/retry`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) { setActionError((p) => ({ ...p, [id]: data.error ?? "Error al reintentar" })); return; }
      const retryStatus = data.result?.status;
      setExceptions((prev) => prev.map((e) =>
        e.id === id ? { ...e, status: retryStatus === "completed" ? "resolved" : "pending" } : e
      ));
      setExpanded(null);
    } catch { setActionError((p) => ({ ...p, [id]: "No se pudo conectar al servidor" })); }
    finally { setLoadingId(null); }
  }

  async function handleResolve(id: number) {
    setLoadingId(id);
    setActionError((p) => ({ ...p, [id]: "" }));
    try {
      const res = await fetch(`/api/v1/exceptions/${id}/resolve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notes: "Resuelto manualmente desde panel" }) });
      const data = await res.json();
      if (!res.ok) { setActionError((p) => ({ ...p, [id]: data.error ?? "Error al resolver" })); return; }
      setExceptions((prev) => prev.map((e) => e.id === id ? { ...e, status: "resolved" } : e));
      setExpanded(null);
    } catch { setActionError((p) => ({ ...p, [id]: "No se pudo conectar al servidor" })); }
    finally { setLoadingId(null); }
  }

  const filtered = useMemo(() => {
    return exceptions.filter(e => {
      if (status && e.status !== status) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !e.originalFilename?.toLowerCase().includes(q) &&
          !e.errorCode?.toLowerCase().includes(q) &&
          !e.failureReason?.toLowerCase().includes(q)
        ) return false;
      }
      return true;
    });
  }, [exceptions, search, status]);

  const pendingCount = exceptions.filter(e => e.status === "pending").length;

  function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString("es-MX", {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="h-14 border-b border-border px-6 flex items-center gap-3 shrink-0">
        <AlertTriangle className={cn("w-4 h-4", pendingCount > 0 ? "text-warning" : "text-muted-foreground")} />
        <div>
          <h1 className="text-sm font-semibold text-foreground">Excepciones</h1>
          <p className="text-xs text-muted-foreground">
            {pendingCount > 0 ? `${pendingCount} pendiente${pendingCount > 1 ? "s" : ""} de revisión` : "Sin excepciones pendientes"}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="px-6 py-3 border-b border-border flex items-center gap-3 shrink-0">
        <div className="relative flex-1 max-w-64">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por archivo o error..."
            className="w-full bg-secondary/50 border border-border/60 rounded-lg pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/20"
          />
        </div>
        <div className="flex items-center gap-1.5">
          {Object.entries(STATUS_META).map(([k, v]) => (
            <button
              key={k}
              onClick={() => setStatus(status === k ? "" : k)}
              className={cn(
                "text-xs font-medium px-2.5 py-1 rounded-full border transition-all",
                status === k
                  ? `${v.bg} ${v.color} ${v.border}`
                  : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              {v.label}
              <span className="ml-1.5 text-[10px] opacity-60">
                {exceptions.filter(e => e.status === k).length}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-12 h-12 rounded-2xl bg-success/10 border border-success/20 flex items-center justify-center mb-4">
              <CheckCircle2 className="w-5 h-5 text-success" />
            </div>
            <p className="text-sm font-medium text-foreground">
              {exceptions.length === 0 ? "Sin excepciones registradas" : "Sin resultados"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {exceptions.length === 0
                ? "Los documentos con errores de procesamiento aparecerán aquí"
                : "Prueba con otro filtro"}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(ex => {
              const stMeta  = STATUS_META[ex.status] ?? STATUS_META.pending;
              const stgMeta = STAGE_META[ex.failureStage] ?? STAGE_META.extract;
              const isOpen  = expanded === ex.id;

              return (
                <div
                  key={ex.id}
                  className={cn(
                    "bg-card border rounded-xl overflow-hidden transition-all",
                    isOpen ? "border-primary/30" : "border-border hover:border-border/80"
                  )}
                >
                  {/* Row header */}
                  <button
                    className="w-full flex items-center gap-4 px-4 py-3 text-left"
                    onClick={() => setExpanded(isOpen ? null : ex.id)}
                  >
                    <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0", stMeta.bg)}>
                      <XCircle className={cn("w-4 h-4", stMeta.color)} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-medium text-foreground">
                          {ex.originalFilename ?? `Excepción #${ex.id}`}
                        </span>
                        {ex.documentType && (
                          <span className="text-[10px] text-muted-foreground bg-secondary/80 px-1.5 py-0.5 rounded border border-border/60">
                            {DOC_LABELS[ex.documentType] ?? ex.documentType}
                          </span>
                        )}
                        <span className={cn("text-[10px] font-medium", stgMeta.color)}>
                          {stgMeta.label}
                        </span>
                        {ex.errorCode && (
                          <span className="text-[10px] text-muted-foreground font-mono bg-secondary/80 px-1.5 py-0.5 rounded">
                            {ex.errorCode}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                        {ex.failureReason ?? "Sin descripción del error"}
                      </p>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      {ex.retryCount > 0 && (
                        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <RotateCcw className="w-3 h-3" />
                          {ex.retryCount}
                        </div>
                      )}
                      <span className={cn(
                        "text-[10px] font-medium px-2 py-0.5 rounded-full border",
                        stMeta.bg, stMeta.color, stMeta.border
                      )}>
                        {stMeta.label}
                      </span>
                      <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                        {fmtDate(ex.createdAt)}
                      </span>
                    </div>
                  </button>

                  {/* Expanded detail */}
                  {isOpen && (
                    <div className="border-t border-border/60 px-4 py-4 bg-secondary/20 space-y-3">
                      <div>
                        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                          Detalle del error
                        </p>
                        <p className="text-xs text-foreground font-mono bg-background/60 border border-border/60 rounded-lg px-3 py-2.5 leading-relaxed">
                          {ex.failureReason ?? "Sin información adicional"}
                        </p>
                      </div>

                      {actionError[ex.id] && (
                        <p className="text-xs text-destructive flex items-center gap-1.5">
                          <AlertTriangle className="w-3 h-3 shrink-0" />
                          {actionError[ex.id]}
                        </p>
                      )}
                      <div className="flex items-center gap-2 pt-1">
                        {ex.status !== "resolved" && ex.status !== "dismissed" && (
                          <>
                            <button
                              disabled={loadingId === ex.id}
                              onClick={() => handleRetry(ex.id)}
                              className="flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 bg-primary/10 hover:bg-primary/15 border border-primary/20 px-3 py-1.5 rounded-lg transition-all disabled:opacity-50"
                            >
                              {loadingId === ex.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                              Reintentar
                            </button>
                            <button
                              disabled={loadingId === ex.id}
                              onClick={() => handleResolve(ex.id)}
                              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground bg-secondary/50 hover:bg-secondary border border-border/60 px-3 py-1.5 rounded-lg transition-all disabled:opacity-50"
                            >
                              <CheckCircle2 className="w-3 h-3" />
                              Marcar resuelto
                            </button>
                          </>
                        )}
                        <span className="text-[11px] text-muted-foreground ml-2">ID #{ex.id}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
