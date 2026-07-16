"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  FileUp, FileText, Upload, CheckCircle2, XCircle,
  Clock, Loader2, AlertTriangle, ChevronRight, X,
  Files, ArrowRight,
} from "lucide-react";
import { useFeature } from "@/components/providers/feature-provider";
import { DOC_STATUS } from "@/lib/status-config";

const DOC_TYPES = [
  { id: "invoice",        label: "Factura",    desc: "PDF de factura de proveedor" },
  { id: "purchase_order", label: "Orden de compra", desc: "PDF de purchase order" },
  { id: "xml_cfdi",       label: "CFDI XML",   desc: "XML de comprobante fiscal" },
];


const DOC_LABELS: Record<string, string> = {
  invoice: "Factura", purchase_order: "OC", xml_cfdi: "CFDI",
};

// Terminal = no longer self-advancing. pending_approval/approved wait on a human,
// so polling them forever just wastes requests until the tab closes.
const TERMINAL = new Set(["completed", "review", "failed", "pending_approval", "approved"]);
const BULK_MAX = 20;
const POLL_MIN = 3000;
const POLL_MAX = 15000;

interface Subsidiary { id: string; name: string; }
interface DocRow {
  id: number;
  documentType: string;
  status: string;
  vendor: string | null;
  numDoc: string | null;
  total: number | null;
  fallbackUsed: boolean;
  createdAt: string;
}

type BatchItem = {
  file: File;
  status: "pending" | "uploading" | "completed" | "review" | "failed" | "queued";
  docId?: number;
  error?: string;
};

function relativeDate(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diff < 1)  return "ahora";
  if (diff < 60) return `hace ${diff} min`;
  const h = Math.floor(diff / 60);
  if (h < 24) return `hace ${h}h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "ayer" : `hace ${d} días`;
}

function fmt(n: number | null): string | null {
  if (n === null) return null;
  return n.toLocaleString("es-MX", { minimumFractionDigits: 2 });
}

// ─── Polling hook ────────────────────────────────────────────────────────────
function useDocPolling(docs: DocRow[], onUpdate: (updated: DocRow) => void, onStale: (ids: number[]) => void) {
  const active = docs.filter(d => !TERMINAL.has(d.status));
  const failCounts = useRef<Map<number, number>>(new Map());
  const activeIds = active.map(d => d.id);
  const key = activeIds.join(",");

  useEffect(() => {
    if (activeIds.length === 0) return;
    let cancelled = false;
    let delay = POLL_MIN;
    let timeout: ReturnType<typeof setTimeout>;

    const bumpFail = (staleIds: number[]) => {
      for (const id of activeIds) {
        const fails = (failCounts.current.get(id) ?? 0) + 1;
        failCounts.current.set(id, fails);
        if (fails >= 3) staleIds.push(id);
      }
    };

    const tick = async () => {
      const staleIds: number[] = [];
      let changed = false;
      try {
        // One batched request for all active docs instead of N per-doc requests.
        const res = await fetch(`/api/v1/workflow/status?ids=${activeIds.join(",")}`);
        if (res.ok) {
          const { documents } = await res.json() as { documents: Array<{ id: number; status: string; vendor: string | null }> };
          const byId = new Map(documents.map(d => [d.id, d]));
          for (const d of active) {
            const u = byId.get(d.id);
            if (!u) continue;
            failCounts.current.delete(d.id);
            if (u.status !== d.status) changed = true;
            onUpdate({ ...d, status: u.status, vendor: u.vendor ?? d.vendor });
          }
        } else {
          bumpFail(staleIds);
        }
      } catch {
        bumpFail(staleIds);
      }
      if (staleIds.length > 0) onStale(staleIds);
      // Backoff: reset to fast polling on any change, otherwise grow toward the cap.
      delay = changed ? POLL_MIN : Math.min(POLL_MAX, Math.round(delay * 1.5));
      if (!cancelled) timeout = setTimeout(tick, delay);
    };

    timeout = setTimeout(tick, delay);
    return () => { cancelled = true; clearTimeout(timeout); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
}

// ─── Single upload form ──────────────────────────────────────────────────────
function SingleUpload({
  docType, setDocType, subsidiary, setSubsidiary, subsidiaries,
}: {
  docType: string; setDocType: (v: string) => void;
  subsidiary: string; setSubsidiary: (v: string) => void;
  subsidiaries: Subsidiary[];
}) {
  const router  = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file,      setFile]      = useState<File | null>(null);
  const [dragging,  setDragging]  = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error,     setError]     = useState("");

  const acceptAttr = docType === "xml_cfdi"
    ? ".xml,text/xml,application/xml"
    : ".pdf,.jpg,.jpeg,.png,.webp,.tiff,.tif";

  function handleDrop(e: React.DragEvent) {
    e.preventDefault(); setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) setFile(dropped);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !subsidiary) return;
    setError(""); setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("subsidiaryId", subsidiary);
      fd.append("documentType", docType);
      const res  = await fetch("/api/v1/workflow/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Error al procesar"); return; }
      if (data.status === "review" || data.status === "pending_approval") {
        router.push(`/history/${data.documentId}`); return;
      }
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    } catch {
      setError("No se pudo conectar al servidor");
    } finally {
      setUploading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <DocTypeSelector docType={docType} setDocType={setDocType} />
      <SubsidiarySelector subsidiary={subsidiary} setSubsidiary={setSubsidiary} subsidiaries={subsidiaries} />

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Archivo</label>
        <div
          className={cn(
            "relative border-2 border-dashed rounded-xl p-6 text-center transition-all cursor-pointer",
            dragging ? "border-primary/60 bg-primary/5"
              : file ? "border-success/40 bg-success/5"
              : "border-border/60 hover:border-border"
          )}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileRef.current?.click()}
        >
          <input ref={fileRef} type="file" accept={acceptAttr} className="hidden"
            onChange={e => setFile(e.target.files?.[0] ?? null)} />
          {file ? (
            <div className="flex items-center justify-center gap-2">
              <FileText className="w-4 h-4 text-success shrink-0" />
              <span className="text-xs text-foreground truncate max-w-[180px]">{file.name}</span>
              <button type="button" onClick={e => { e.stopPropagation(); setFile(null); }}
                className="ml-1 text-muted-foreground hover:text-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <>
              <Upload className="w-6 h-6 text-muted-foreground mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">
                Arrastra tu archivo aquí o <span className="text-primary">selecciónalo</span>
              </p>
              <p className="text-[11px] text-muted-foreground/60 mt-1">
                {docType === "xml_cfdi" ? "XML — máx. 20 MB" : "PDF, JPG, PNG, WEBP — máx. 20 MB"}
              </p>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2 text-xs text-destructive flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />{error}
        </div>
      )}

      <button type="submit" disabled={!file || !subsidiary || uploading}
        className="w-full bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground font-medium text-sm py-2.5 rounded-lg transition-all flex items-center justify-center gap-2">
        {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" />}
        {uploading ? "Procesando..." : "Procesar documento"}
      </button>
    </form>
  );
}

// ─── Bulk upload form ────────────────────────────────────────────────────────
function BulkUpload({
  docType, setDocType, subsidiary, setSubsidiary, subsidiaries,
}: {
  docType: string; setDocType: (v: string) => void;
  subsidiary: string; setSubsidiary: (v: string) => void;
  subsidiaries: Subsidiary[];
}) {
  const router   = useRouter();
  const fileRef  = useRef<HTMLInputElement>(null);
  const [items,   setItems]   = useState<BatchItem[]>([]);
  const [running, setRunning] = useState(false);
  const [done,    setDone]    = useState(false);

  const [dragging, setDragging] = useState(false);

  const acceptAttr = docType === "xml_cfdi"
    ? ".xml,text/xml,application/xml"
    : ".pdf,.jpg,.jpeg,.png,.webp,.tiff,.tif";

  function addFiles(files: FileList | null) {
    if (!files) return;
    const incoming = Array.from(files);
    setItems(prev => {
      const available = BULK_MAX - prev.length;
      if (available <= 0) return prev;
      const next: BatchItem[] = incoming.slice(0, available).map(f => ({ file: f, status: "pending" }));
      return [...prev, ...next];
    });
  }

  function removeItem(idx: number) {
    setItems(prev => prev.filter((_, i) => i !== idx));
  }

  async function runBatch() {
    if (!subsidiary || items.length === 0 || running) return;
    setRunning(true); setDone(false);

    for (let i = 0; i < items.length; i++) {
      if (items[i].status !== "pending") continue;

      setItems(prev => prev.map((it, idx) => idx === i ? { ...it, status: "uploading" } : it));

      try {
        const fd = new FormData();
        fd.append("file", items[i].file);
        fd.append("subsidiaryId", subsidiary);
        fd.append("documentType", docType);
        fd.append("bulk", "true");
        const res  = await fetch("/api/v1/workflow/upload", { method: "POST", body: fd });
        const data = await res.json();

        if (!res.ok) {
          setItems(prev => prev.map((it, idx) =>
            idx === i ? { ...it, status: "failed", error: data.error ?? "Error" } : it));
        } else {
          const finalStatus = (data.status === "review" ? "review"
            : data.status === "completed" ? "completed"
            : data.status === "queued" ? "queued"
            : "failed") as BatchItem["status"];
          setItems(prev => prev.map((it, idx) =>
            idx === i ? { ...it, status: finalStatus, docId: data.documentId } : it));
        }
      } catch {
        setItems(prev => prev.map((it, idx) =>
          idx === i ? { ...it, status: "failed", error: "Sin conexión" } : it));
      }
    }

    setRunning(false); setDone(true);
    router.refresh();
  }

  const allDone = items.length > 0 && items.every(it => it.status !== "pending" && it.status !== "uploading");
  const countBy = (s: BatchItem["status"]) => items.filter(it => it.status === s).length;

  return (
    <div className="space-y-4">
      <DocTypeSelector docType={docType} setDocType={setDocType} />
      <SubsidiarySelector subsidiary={subsidiary} setSubsidiary={setSubsidiary} subsidiaries={subsidiaries} />

      {/* File picker */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-muted-foreground">Archivos</label>
          <span className="text-[11px] text-muted-foreground/60">{items.length}/{BULK_MAX}</span>
        </div>
        <div
          className={cn(
            "border-2 border-dashed rounded-xl p-5 text-center transition-all",
            items.length >= BULK_MAX
              ? "border-border/30 opacity-50 cursor-not-allowed"
              : dragging
              ? "border-primary/60 bg-primary/5 cursor-copy"
              : "border-border/60 hover:border-border cursor-pointer"
          )}
          onClick={() => items.length < BULK_MAX && fileRef.current?.click()}
          onDragOver={e => { e.preventDefault(); if (items.length < BULK_MAX) setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => {
            e.preventDefault(); setDragging(false);
            if (items.length < BULK_MAX) addFiles(e.dataTransfer.files);
          }}
        >
          <input ref={fileRef} type="file" accept={acceptAttr} multiple className="hidden"
            onChange={e => addFiles(e.target.files)} />
          <Files className="w-5 h-5 text-muted-foreground mx-auto mb-1.5" />
          <p className="text-xs text-muted-foreground">
            {items.length >= BULK_MAX
              ? `Límite de ${BULK_MAX} archivos alcanzado`
              : <>Selecciona <span className="text-primary">múltiples archivos</span></>
            }
          </p>
        </div>
      </div>

      {/* Queue list */}
      {items.length > 0 && (
        <div className="border border-border rounded-lg overflow-hidden">
          {items.map((it, i) => {
            const meta = it.status === "uploading"
              ? DOC_STATUS.processing
              : it.status === "completed" ? DOC_STATUS.completed
              : it.status === "review" ? DOC_STATUS.review
              : it.status === "failed" ? DOC_STATUS.failed
              : DOC_STATUS.uploaded;
            const Icon = meta.icon;
            return (
              <div key={i} className="flex items-center gap-2.5 px-3 py-2 border-b border-border last:border-0">
                <div className={cn("w-6 h-6 rounded flex items-center justify-center shrink-0", meta.bg)}>
                  <Icon className={cn("w-3 h-3", meta.color, it.status === "uploading" ? "animate-spin" : "")} />
                </div>
                <span className="flex-1 text-xs text-foreground truncate">{it.file.name}</span>
                {it.docId && (
                  <Link href={`/history/${it.docId}`}
                    className="text-[10px] text-primary hover:underline shrink-0">
                    Ver <ArrowRight className="inline w-2.5 h-2.5" />
                  </Link>
                )}
                {it.status === "pending" && !running && (
                  <button type="button" onClick={() => removeItem(i)}
                    className="text-muted-foreground hover:text-foreground shrink-0">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Summary after done */}
      {allDone && (
        <div className="flex gap-3 text-xs">
          {countBy("completed") > 0 && (
            <span className="text-success">{countBy("completed")} completados</span>
          )}
          {countBy("review") > 0 && (
            <span className="text-warning">{countBy("review")} en revisión</span>
          )}
          {countBy("failed") > 0 && (
            <span className="text-destructive">{countBy("failed")} con error</span>
          )}
        </div>
      )}

      <button
        type="button"
        disabled={items.length === 0 || !subsidiary || running || allDone}
        onClick={runBatch}
        className="w-full bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground font-medium text-sm py-2.5 rounded-lg transition-all flex items-center justify-center gap-2"
      >
        {running
          ? <><Loader2 className="w-4 h-4 animate-spin" /> Procesando {items.filter(i => i.status === "uploading").length > 0 ? `${items.findIndex(i => i.status === "uploading") + 1}/${items.length}` : ""}...</>
          : allDone
          ? <><CheckCircle2 className="w-4 h-4" /> Lote completado</>
          : <><FileUp className="w-4 h-4" /> Procesar {items.length} {items.length === 1 ? "archivo" : "archivos"}</>
        }
      </button>

      {allDone && (
        <button type="button" onClick={() => { setItems([]); setDone(false); }}
          className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors py-1">
          Nuevo lote
        </button>
      )}
    </div>
  );
}

// ─── Shared sub-components ────────────────────────────────────────────────────
function DocTypeSelector({ docType, setDocType }: { docType: string; setDocType: (v: string) => void }) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-muted-foreground">Tipo de documento</label>
      <div className="grid grid-cols-3 gap-2">
        {DOC_TYPES.map(t => (
          <button key={t.id} type="button" onClick={() => setDocType(t.id)}
            className={cn(
              "flex flex-col items-center gap-1 p-2.5 rounded-lg border text-xs font-medium transition-all",
              docType === t.id
                ? "border-primary/60 bg-primary/10 text-primary"
                : "border-border bg-secondary/30 text-muted-foreground hover:border-border/80 hover:text-foreground"
            )}>
            <FileText className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function SubsidiarySelector({
  subsidiary, setSubsidiary, subsidiaries,
}: { subsidiary: string; setSubsidiary: (v: string) => void; subsidiaries: Subsidiary[] }) {
  if (subsidiaries.length === 0) {
    return (
      <div className="bg-warning/5 border border-warning/20 rounded-lg p-3 text-xs text-warning">
        No hay subsidiarias configuradas.{" "}
        <Link href="/settings" className="underline">Configura una →</Link>
      </div>
    );
  }
  if (subsidiaries.length === 1) {
    return (
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Subsidiaria</label>
        <div className="bg-secondary/50 border border-border/60 rounded-lg px-3 py-2 text-xs text-foreground">
          {subsidiaries[0].name}
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">Subsidiaria</label>
      <select value={subsidiary} onChange={e => setSubsidiary(e.target.value)}
        className="w-full bg-secondary/50 border border-border/60 rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:border-primary/60">
        {subsidiaries.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export function WorkflowUploadClient({
  subsidiaries,
  recentDocs: initialDocs,
}: {
  subsidiaries: Subsidiary[];
  recentDocs: DocRow[];
}) {
  const bulkEnabled = useFeature("bulk_upload");
  const [docType,    setDocType]    = useState(DOC_TYPES[0].id);
  const [subsidiary, setSubsidiary] = useState(subsidiaries[0]?.id ?? "");
  const [bulk,       setBulk]       = useState(false);
  const [docs,       setDocs]       = useState(initialDocs);

  const [stalePollIds, setStalePollIds] = useState<number[]>([]);

  const updateDoc = useCallback((updated: DocRow) => {
    setDocs(prev => prev.map(d => d.id === updated.id ? { ...d, ...updated } : d));
  }, []);

  const handleStale = useCallback((ids: number[]) => {
    setStalePollIds(prev => [...new Set([...prev, ...ids])]);
  }, []);

  useDocPolling(docs, updateDoc, handleStale);

  return (
    <div className="flex-1 flex flex-col overflow-auto">
      {/* Header */}
      <div className="h-14 border-b border-border px-6 flex items-center gap-3 shrink-0">
        <FileUp className="w-4 h-4 text-muted-foreground" />
        <div>
          <h1 className="text-sm font-semibold text-foreground">Workflow</h1>
          <p className="text-xs text-muted-foreground">Sube y procesa documentos</p>
        </div>
      </div>

      <div className="flex-1 p-6 grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* Upload form */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-card border border-border rounded-xl p-5">
            {/* Mode toggle */}
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-medium text-foreground">Nuevo documento</h2>
              {bulkEnabled && (
                <button
                  type="button"
                  onClick={() => setBulk(b => !b)}
                  className={cn(
                    "flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border transition-all",
                    bulk
                      ? "border-primary/60 bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Files className="w-3.5 h-3.5" />
                  {bulk ? "Lote activo" : "Subir varios"}
                </button>
              )}
            </div>

            {bulk ? (
              <BulkUpload
                docType={docType} setDocType={setDocType}
                subsidiary={subsidiary} setSubsidiary={setSubsidiary}
                subsidiaries={subsidiaries}
              />
            ) : (
              <SingleUpload
                docType={docType} setDocType={setDocType}
                subsidiary={subsidiary} setSubsidiary={setSubsidiary}
                subsidiaries={subsidiaries}
              />
            )}
          </div>
        </div>

        {/* Recent documents */}
        <div className="lg:col-span-3">
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="text-sm font-medium text-foreground">Documentos recientes</h2>
              <p className="text-xs text-muted-foreground mt-0.5">{docs.length} en cola</p>
            </div>

            {stalePollIds.length > 0 && (
              <div className="px-4 py-2.5 bg-warning/8 border-b border-warning/20 flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-warning shrink-0" />
                <p className="text-xs text-warning flex-1">
                  El estado de {stalePollIds.length} documento{stalePollIds.length !== 1 ? "s" : ""} no pudo actualizarse.
                </p>
                <button
                  onClick={() => window.location.reload()}
                  className="text-xs text-warning font-medium underline underline-offset-2 shrink-0"
                >
                  Recargar
                </button>
              </div>
            )}

            {docs.length === 0 ? (
              <div className="py-16 flex flex-col items-center justify-center text-center">
                <FileText className="w-8 h-8 text-muted-foreground mb-3" />
                <p className="text-sm font-medium text-foreground">Sin documentos</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Los documentos que subas aparecerán aquí
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {docs.map(doc => {
                  const meta = DOC_STATUS[doc.status] ?? DOC_STATUS.uploaded;
                  const Icon = meta.icon;
                  const spinning = doc.status === "extracting" || doc.status === "processing";
                  return (
                    <Link key={doc.id} href={`/history/${doc.id}`}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-accent/30 transition-colors group">
                      <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0", meta.bg)}>
                        <Icon className={cn("w-4 h-4", meta.color, spinning ? "animate-spin" : "")} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-foreground">
                            {doc.vendor ?? "Proveedor desconocido"}
                          </span>
                          <span className="text-[10px] text-muted-foreground/60 bg-secondary/80 px-1.5 py-0.5 rounded">
                            {DOC_LABELS[doc.documentType] ?? doc.documentType}
                          </span>
                          {doc.fallbackUsed && (
                            <span className="text-[10px] text-warning bg-warning/10 px-1.5 py-0.5 rounded">
                              fallback
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className={cn("text-[11px] font-medium", meta.color)}>{meta.label}</span>
                          <span className="text-[11px] text-muted-foreground/60">·</span>
                          <span className="text-[11px] text-muted-foreground">{relativeDate(doc.createdAt)}</span>
                          {doc.total !== null && (
                            <>
                              <span className="text-[11px] text-muted-foreground/60">·</span>
                              <span className="text-[11px] text-muted-foreground">
                                ${fmt(doc.total)}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
