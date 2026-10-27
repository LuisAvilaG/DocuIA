"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Check, FileSearch, FileText, Loader2, Search, Trash2, Upload, X } from "lucide-react";
import { uploadContractFile } from "@/lib/contracts/upload-client";

type ArchiveDoc = { id: string; originalName: string; documentCode: string | null; documentType: string | null; title: string | null; status: string; pageCount: number | null; indexedPages: number; errorMessage: string | null; createdAt: string; references?: { total: number; missing: number; review: number } };
type ArchiveRef = { id: string; rawCode: string; pageNumber: number; context: string; status: string; assessment: string | null; reason: string | null; targetDocumentId: string | null; target: ArchiveDoc | null };

const STATUS: Record<string, string> = { queued: "En cola", processing: "Indexando", ready: "Listo", failed: "Error", missing: "Sin localizar", ambiguous: "Varias coincidencias", related: "Pertinente", unrelated: "No pertinente", review: "Revisar", confirmed: "Confirmada", rejected: "Descartada" };

export function ArchiveClient({ canRemove }: { canRemove: boolean }) {
  const [documents, setDocuments] = useState<ArchiveDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const selectedRequest = useRef(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ document: ArchiveDoc; references: ArchiveRef[] } | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [code, setCode] = useState("");
  const [targetByRef, setTargetByRef] = useState<Record<string, string>>({});
  const [targetCodeByRef, setTargetCodeByRef] = useState<Record<string, string>>({});
  const [manualCode, setManualCode] = useState("");
  const [manualPage, setManualPage] = useState("1");
  const [manualContext, setManualContext] = useState("");

  const loadList = useCallback(async () => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (status) params.set("status", status);
    const response = await fetch(`/api/v1/contracts/archive?${params}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "No se pudo cargar el archivo");
    setDocuments(data.documents);
  }, [query, status]);

  const loadSelected = useCallback(async () => {
    if (!selectedId) return;
    const request = ++selectedRequest.current;
    const response = await fetch(`/api/v1/contracts/archive/${selectedId}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "No se pudo abrir el documento");
    if (request !== selectedRequest.current) return;
    setSelected(data);
    setCode(data.document.documentCode ?? "");
  }, [selectedId]);

  useEffect(() => { const timer = setTimeout(() => { loadList().catch((cause) => setError(cause.message)).finally(() => setLoading(false)); }, 250); return () => clearTimeout(timer); }, [loadList]);
  useEffect(() => { const timer = setTimeout(() => { loadSelected().catch((cause) => setError(cause.message)); }, 0); return () => clearTimeout(timer); }, [loadSelected]);
  useEffect(() => {
    if (!documents.some((doc) => doc.status === "queued" || doc.status === "processing")) return;
    const timer = setInterval(() => { loadList().catch(() => undefined); loadSelected().catch(() => undefined); }, 5000);
    return () => clearInterval(timer);
  }, [documents, loadList, loadSelected]);

  async function upload() {
    if (!file) return;
    setBusy(true); setError("");
    let uploadId: string | null = null;
    try {
      uploadId = await uploadContractFile(file, (fraction) => setProgress(`Cargando ${Math.round(fraction * 100)} %`));
      setProgress("Preparando índice…");
      const response = await fetch("/api/v1/contracts/archive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uploadId }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "No se pudo agregar al archivo");
      setFile(null); setSelectedId(data.id); await loadList();
    } catch (cause) { if (uploadId) await fetch(`/api/v1/contracts/uploads/${uploadId}`, { method: "DELETE" }).catch(() => undefined); setError(cause instanceof Error ? cause.message : "Error de carga"); }
    finally { setBusy(false); setProgress(""); }
  }

  async function saveCode() {
    if (!selectedId) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/v1/contracts/archive/${selectedId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ documentCode: code }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "No se pudo guardar");
      await Promise.all([loadList(), loadSelected()]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo guardar"); }
    finally { setBusy(false); }
  }

  async function review(reference: ArchiveRef, decision: "confirmed" | "rejected") {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/v1/contracts/archive/references/${reference.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: decision, targetDocumentId: targetByRef[reference.id] || reference.targetDocumentId, targetCode: targetCodeByRef[reference.id] }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "No se pudo revisar");
      await Promise.all([loadList(), loadSelected()]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo revisar"); }
    finally { setBusy(false); }
  }

  async function addReference() {
    if (!selectedId) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/v1/contracts/archive/${selectedId}/references`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: manualCode, pageNumber: Number(manualPage), context: manualContext }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "No se pudo agregar");
      setManualCode(""); setManualContext(""); await Promise.all([loadList(), loadSelected()]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo agregar"); }
    finally { setBusy(false); }
  }

  async function removeSelected() {
    if (!selectedId || !selected || !canRemove) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/v1/contracts/archive/${selectedId}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "No se pudo retirar el documento");
      selectedRequest.current++;
      setSelected(null); setSelectedId(null); setConfirmRemove(false);
      await loadList();
      setNotice("Documento retirado del Archivo. El caso original, si existe, conserva su historial.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo retirar el documento"); }
    finally { setBusy(false); }
  }

  return <div className="flex-1 overflow-y-auto bg-background p-6">
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div><h1 className="text-lg font-semibold tracking-tight">Archivo documental</h1><p className="mt-1 text-xs text-muted-foreground">Encuentra el origen de cada referencia y comprueba si habla del mismo asunto.</p></div>
        <div className="text-right text-[11px] text-muted-foreground"><span className="block font-semibold text-foreground">{documents.length} documentos visibles</span><span>PDF y Word · extracción por páginas</span></div>
      </header>
      <section className="rounded-xl border border-border bg-card px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <Upload className="h-4 w-4 text-primary" />
          <label className="min-w-0 flex-1 text-xs text-foreground">Agregar cartas, informes o transmittals
            <input type="file" accept=".pdf,.docx,.txt,.xml,.png,.jpg,.jpeg,.tiff" onChange={(event) => setFile(event.target.files?.[0] ?? null)} className="mt-1.5 block w-full text-[11px] text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5" />
          </label>
          <button type="button" disabled={!file || busy} onClick={upload} className="rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50">{busy ? "Procesando…" : "Agregar al archivo"}</button>
        </div>
        {progress && <p role="status" className="mt-2 text-[11px] text-primary">{progress}</p>}
        <p className="mt-2 text-[11px] text-muted-foreground">Los documentos quedan disponibles para futuras cartas; una referencia pendiente se enlaza al cargar su origen.</p>
      </section>
      {error && <p role="alert" className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">{error}</p>}
      {notice && <p role="status" className="rounded-md border border-border bg-card px-3 py-2 text-xs text-foreground">{notice}</p>}
      <div className="grid min-h-[480px] gap-4 lg:grid-cols-[minmax(280px,0.85fr)_minmax(0,1.4fr)]">
        <section className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="space-y-3 border-b border-border p-4">
            <h2 className="text-xs font-semibold">Documentos</h2>
            <div className="flex gap-2"><div className="relative min-w-0 flex-1"><Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Código, asunto o archivo" className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-2 text-xs" /></div>
              <select aria-label="Filtrar por estado" value={status} onChange={(event) => setStatus(event.target.value)} className="rounded-md border border-border bg-background px-2 text-xs"><option value="">Todos</option><option value="ready">Listos</option><option value="processing">Indexando</option><option value="failed">Con error</option></select>
            </div>
          </div>
          <div className="max-h-[640px] divide-y divide-border overflow-y-auto">{loading ? <p className="flex items-center justify-center gap-2 p-6 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando archivo…</p> : documents.length === 0 ? <p className="p-6 text-center text-xs text-muted-foreground">Aún no hay documentos para esta búsqueda.</p> : documents.map((doc) =>
            <button type="button" key={doc.id} onClick={() => { selectedRequest.current++; setSelected(null); setSelectedId(doc.id); setConfirmRemove(false); setNotice(""); }} className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary/50 ${selectedId === doc.id ? "bg-primary/5" : ""}`}>
              <FileText className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold">{doc.documentCode || doc.originalName}</span><span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{doc.title || doc.originalName}</span><span className="mt-1 block text-[10px] text-muted-foreground">{STATUS[doc.status] || doc.status}{doc.pageCount ? ` · ${doc.indexedPages}/${doc.pageCount} páginas` : ""}{doc.references?.total ? ` · ${doc.references.total} referencias` : ""}</span></span><ArrowRight className="mt-1 h-3.5 w-3.5 text-muted-foreground" />
            </button>)}</div>
        </section>
        <section className="overflow-hidden rounded-xl border border-border bg-card">{!selected ? <div className="flex h-full min-h-[380px] flex-col items-center justify-center p-8 text-center"><FileSearch className="h-6 w-6 text-primary" /><p className="mt-3 text-xs font-semibold">Selecciona un documento</p><p className="mt-1 max-w-xs text-[11px] text-muted-foreground">Aquí verás sus referencias, el documento de origen y la evidencia del cotejo.</p></div> : <>
          <div className="border-b border-border p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] uppercase tracking-wide text-muted-foreground">{selected.document.documentType || "Documento"} · {STATUS[selected.document.status]}</p><h2 className="mt-1 text-sm font-semibold">{selected.document.title || selected.document.originalName}</h2><p className="mt-1 text-[11px] text-muted-foreground">{selected.document.originalName}</p></div><div className="flex flex-wrap items-center gap-2"><a href={`/api/v1/contracts/archive/${selected.document.id}/file`} target="_blank" rel="noreferrer" className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-secondary">Ver original ↗</a>{canRemove && <button type="button" disabled={busy || selected.document.status === "queued" || selected.document.status === "processing"} onClick={() => setConfirmRemove(true)} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-destructive hover:bg-destructive/5 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" /> Quitar del Archivo</button>}</div></div>
            {confirmRemove && <div role="group" aria-label="Confirmar retiro del Archivo" className="mt-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3"><p className="text-xs font-medium">¿Quitar {selected.document.documentCode || selected.document.originalName} del Archivo?</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Dejará de aparecer en búsquedas. Las referencias que lo citan se volverán a revisar; el historial de Casos no se elimina.</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => setConfirmRemove(false)} className="rounded-md border border-border bg-card px-3 py-1.5 text-xs disabled:opacity-50">Cancelar</button><button type="button" disabled={busy} onClick={removeSelected} className="rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50">{busy ? "Quitando…" : "Sí, quitar del Archivo"}</button></div></div>}
            <div className="mt-4 flex flex-wrap items-end gap-2"><label className="min-w-[220px] flex-1 text-[11px] text-muted-foreground">Código propio del documento<input value={code} onChange={(event) => setCode(event.target.value)} placeholder="Ej. CARTA-015-2026" className="mt-1 block w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground" /></label><button type="button" disabled={busy || code === (selected.document.documentCode ?? "")} onClick={saveCode} className="rounded-md border border-border px-3 py-1.5 text-xs disabled:opacity-50">Guardar código</button></div>
            {selected.document.errorMessage && <p className="mt-2 text-xs text-destructive">{selected.document.errorMessage}</p>}
          </div>
          <div className="max-h-[620px] overflow-y-auto p-5"><h3 className="text-xs font-semibold">Referencias encontradas <span className="ml-1 text-muted-foreground">{selected.references.length}</span></h3>
            {selected.document.status === "ready" && <div className="mt-3 space-y-2 rounded-lg border border-dashed border-border p-3"><p className="text-[11px] font-medium">¿Faltó detectar un código? Agrégalo con su evidencia.</p><div className="flex gap-2"><input aria-label="Código citado" value={manualCode} onChange={(event) => setManualCode(event.target.value)} placeholder="CARTA-001-2026" className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-[11px]" /><input aria-label="Página de la cita" type="number" min="1" max={selected.document.pageCount ?? 1} value={manualPage} onChange={(event) => setManualPage(event.target.value)} className="w-14 rounded-md border border-border bg-background px-2 py-1 text-[11px]" /></div><input aria-label="Fragmento que cita el documento" value={manualContext} onChange={(event) => setManualContext(event.target.value)} placeholder="Frase del documento que contiene la referencia" className="w-full rounded-md border border-border bg-background px-2 py-1 text-[11px]" /><button type="button" onClick={addReference} disabled={busy || !manualCode || !manualContext} className="rounded-md border border-border px-2 py-1 text-[11px] disabled:opacity-50">Agregar referencia</button></div>}
            {selected.document.status !== "ready" ? <p className="mt-3 text-xs text-muted-foreground">El índice se está preparando; las referencias aparecerán aquí.</p> : selected.references.length === 0 ? <p className="mt-3 text-xs text-muted-foreground">No se detectaron códigos de otros documentos. Puedes corregir el código propio si el encabezado se interpretó mal.</p> : <div className="mt-3 space-y-3">{selected.references.map((reference) => <article key={reference.id} className="rounded-lg border border-border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><span className="text-xs font-semibold">{reference.rawCode}</span><span className="ml-2 text-[10px] text-muted-foreground">p. {reference.pageNumber}</span></div><span className={`text-[10px] font-medium ${["related", "confirmed"].includes(reference.status) ? "text-emerald-700" : ["unrelated", "rejected"].includes(reference.status) ? "text-destructive" : "text-amber-700"}`}>{STATUS[reference.status] || reference.status}</span></div>
                  <p className="mt-2 rounded-md bg-secondary/45 px-2 py-1.5 text-[11px] leading-relaxed text-muted-foreground">{reference.context}</p>
                  <div className="mt-2 text-[11px]">{reference.target ? <a className="font-medium text-primary hover:underline" href={`/api/v1/contracts/archive/${reference.target.id}/file`} target="_blank" rel="noreferrer">Origen: {reference.target.documentCode || reference.target.originalName} ↗</a> : <span className="text-muted-foreground">Origen no localizado automáticamente</span>}</div>
                  {reference.reason && <p className="mt-1.5 text-[11px] text-muted-foreground">{reference.reason}</p>}
                  {reference.status !== "confirmed" && reference.status !== "rejected" && <div className="mt-3 space-y-2"><div className="flex gap-2"><select aria-label={`Documento origen para ${reference.rawCode}`} value={targetByRef[reference.id] ?? reference.targetDocumentId ?? ""} onChange={(event) => setTargetByRef((current) => ({ ...current, [reference.id]: event.target.value }))} className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-[11px]"><option value="">Seleccionar origen visible…</option>{documents.filter((doc) => doc.id !== selected.document.id && doc.status === "ready").map((doc) => <option key={doc.id} value={doc.id}>{doc.documentCode || doc.originalName}</option>)}</select><input aria-label={`Código de origen para ${reference.rawCode}`} value={targetCodeByRef[reference.id] ?? ""} onChange={(event) => setTargetCodeByRef((current) => ({ ...current, [reference.id]: event.target.value }))} placeholder="O escribe el código" className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-[11px]" /></div><div className="flex gap-2"><button type="button" disabled={busy} onClick={() => review(reference, "confirmed")} className="inline-flex items-center gap-1 rounded-md border border-emerald-200 px-2 py-1 text-[11px] text-emerald-700 disabled:opacity-50"><Check className="h-3 w-3" /> Confirmar</button><button type="button" disabled={busy} onClick={() => review(reference, "rejected")} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] disabled:opacity-50"><X className="h-3 w-3" /> Descartar</button></div></div>}
                </article>)}</div>}
          </div>
        </>}</section>
      </div>
    </div>
  </div>;
}
