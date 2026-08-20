"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { ChevronLeft, ChevronRight, Eye, FileUp, Loader2, Plus, Save, Trash2, X, ZoomIn, ZoomOut } from "lucide-react";
import type { VisualFieldMapping } from "@/lib/contracts/visual-training";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

export interface TrainingField { fieldKey: string; label: string }
interface Variant {
  id: string;
  documentType: string;
  name: string;
  originalName: string | null;
  mimeType: string | null;
  signatureText?: string | null;
  mappings: VisualFieldMapping[];
  isActive: boolean;
}

const COLORS = [
  { stroke: "#2563eb", fill: "rgba(37, 99, 235, 0.16)" },
  { stroke: "#0f766e", fill: "rgba(15, 118, 110, 0.16)" },
  { stroke: "#c2410c", fill: "rgba(194, 65, 12, 0.16)" },
  { stroke: "#7c3aed", fill: "rgba(124, 58, 237, 0.16)" },
  { stroke: "#be123c", fill: "rgba(190, 18, 60, 0.16)" },
  { stroke: "#4d7c0f", fill: "rgba(77, 124, 15, 0.16)" },
];
const MAX_FILE_BYTES = 20 * 1024 * 1024;

function colourAt(index: number) { return COLORS[index % COLORS.length]; }
function safeFileName(name: string | null) { return name || "Documento de muestra"; }
function blankPoint() { return { x: 0, y: 0 }; }

export function VisualTrainingWorkspace({ flowId, documentType, documentName, fields, onClose }: {
  flowId: string;
  documentType: string;
  documentName: string;
  fields: TrainingField[];
  onClose: () => void;
}) {
  const [variants, setVariants] = useState<Variant[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [newFile, setNewFile] = useState<File | null>(null);
  const [newFileUrl, setNewFileUrl] = useState<string | null>(null);
  const [variantName, setVariantName] = useState("");
  const [signatureText, setSignatureText] = useState("");
  const [mappings, setMappings] = useState<VisualFieldMapping[]>([]);
  const [activeField, setActiveField] = useState<string | null>(fields[0]?.fieldKey ?? null);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const drawingRef = useRef<{ start: { x: number; y: number }; pointerId: number } | null>(null);
  const [draft, setDraft] = useState<{ x: number; y: number; width: number; height: number } | null>(null);

  const active = variants.find((variant) => variant.id === activeId) ?? null;
  const fileUrl = newFileUrl ?? (active ? `/api/v1/contracts/flow/${flowId}/variants/${active.id}/file` : null);
  const mimeType = newFile?.type ?? active?.mimeType ?? "application/pdf";
  const isPdf = mimeType === "application/pdf";
  const fieldByKey = useMemo(() => new Map(fields.map((field) => [field.fieldKey, field])), [fields]);
  const currentMappings = mappings.filter((mapping) => mapping.page === page);
  const mappedKeys = new Set(mappings.map((mapping) => mapping.fieldKey));
  const coverage = fields.length ? Math.round((fields.filter((field) => mappedKeys.has(field.fieldKey)).length / fields.length) * 100) : 0;

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const response = await fetch(`/api/v1/contracts/flow/${flowId}/variants`);
        const payload = await response.json() as { variants?: Variant[]; error?: string };
        if (!response.ok) throw new Error(payload.error || "No se pudieron cargar las variantes.");
        if (!alive) return;
        const loaded = (payload.variants ?? []).filter((variant) => variant.documentType === documentType);
        setVariants(loaded);
        if (loaded[0]) openVariant(loaded[0]);
        else startNew();
      } catch (cause) {
        if (alive) setError(cause instanceof Error ? cause.message : "No se pudieron cargar las variantes.");
      } finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
    // The editor is reopened deliberately when its document type changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowId, documentType]);

  useEffect(() => () => { if (newFileUrl) URL.revokeObjectURL(newFileUrl); }, [newFileUrl]);

  function openVariant(variant: Variant) {
    setActiveId(variant.id); setNewFile(null); setNewFileUrl(null); setVariantName(variant.name);
    setSignatureText(variant.signatureText ?? "");
    setMappings(Array.isArray(variant.mappings) ? variant.mappings : []); setPage(1); setPages(0); setZoom(1); setError(null); setDeleteArmed(false);
  }
  function startNew() {
    setActiveId(null); setNewFile(null); setNewFileUrl(null); setVariantName(`${documentName} · formato ${variants.length + 1}`);
    setSignatureText("");
    setMappings([]); setPage(1); setPages(0); setZoom(1); setError(null); setDeleteArmed(false);
  }
  function chooseFile(file: File | null) {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES || !["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Usa un PDF, JPG, PNG o WEBP de hasta 20 MB."); return;
    }
    if (newFileUrl) URL.revokeObjectURL(newFileUrl);
    setNewFile(file); setNewFileUrl(URL.createObjectURL(file)); setPages(0); setPage(1); setSignatureText(""); setError(null);
    if (!variantName.trim()) setVariantName(file.name.replace(/\.[^.]+$/, ""));
  }
  function pointFromEvent(event: React.PointerEvent<HTMLDivElement>) {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return blankPoint();
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
  }
  function rectangle(start: { x: number; y: number }, end: { x: number; y: number }) {
    return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
  }
  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!activeField || !fileUrl) return;
    event.preventDefault();
    const start = pointFromEvent(event);
    drawingRef.current = { start, pointerId: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraft({ ...start, width: 0, height: 0 });
  }
  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drawing = drawingRef.current;
    if (!drawing || drawing.pointerId !== event.pointerId) return;
    setDraft(rectangle(drawing.start, pointFromEvent(event)));
  }
  function endDrawing(event: React.PointerEvent<HTMLDivElement>) {
    const drawing = drawingRef.current;
    if (!drawing || drawing.pointerId !== event.pointerId) return;
    drawingRef.current = null;
    const area = rectangle(drawing.start, pointFromEvent(event));
    setDraft(null);
    if (!activeField || area.width < 0.012 || area.height < 0.008) return;
    const selectedText = window.getSelection?.()?.toString().trim().replace(/\s+/g, " ").slice(0, 220) || undefined;
    setMappings((current) => [...current.filter((mapping) => mapping.fieldKey !== activeField), { fieldKey: activeField, page, ...area, ...(selectedText ? { anchorText: selectedText } : {}) }]);
    const remaining = fields.find((field) => field.fieldKey !== activeField && !mappedKeys.has(field.fieldKey));
    if (remaining) setActiveField(remaining.fieldKey);
  }
  function removeMapping(fieldKey: string) { setMappings((current) => current.filter((mapping) => mapping.fieldKey !== fieldKey)); setActiveField(fieldKey); }
  function extractPdfSignature(pdf: { getPage: (page: number) => Promise<{ getTextContent: () => Promise<{ items: unknown[] }> }> }) {
    if (active || signatureText) return;
    void pdf.getPage(1).then((firstPage) => firstPage.getTextContent()).then((content) => {
      const text = content.items.map((item) => typeof (item as { str?: unknown }).str === "string" ? (item as { str: string }).str : "").filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
      if (text) setSignatureText(text.slice(0, 1400));
    }).catch(() => undefined);
  }

  async function save() {
    if (!variantName.trim()) { setError("Ponle un nombre a esta variante."); return; }
    if (!mappings.length) { setError("Marca al menos un campo sobre el documento antes de guardar."); return; }
    if (!active && !newFile) { setError("Sube el documento representativo de esta variante."); return; }
    setSaving(true); setError(null);
    try {
      let saved: Variant;
      if (active) {
        const response = await fetch(`/api/v1/contracts/flow/${flowId}/variants/${active.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: variantName.trim(), mappings, signatureText }) });
        const payload = await response.json() as { error?: string };
        if (!response.ok) throw new Error(payload.error || "No se pudo guardar la variante.");
        saved = { ...active, name: variantName.trim(), mappings, signatureText };
        setVariants((current) => current.map((variant) => variant.id === saved.id ? saved : variant));
      } else {
        const form = new FormData(); form.set("file", newFile!); form.set("documentType", documentType); form.set("name", variantName.trim()); form.set("mappings", JSON.stringify(mappings)); form.set("signatureText", signatureText);
        const response = await fetch(`/api/v1/contracts/flow/${flowId}/variants`, { method: "POST", body: form });
        const payload = await response.json() as { variant?: Variant; error?: string };
        if (!response.ok || !payload.variant) throw new Error(payload.error || "No se pudo guardar la variante.");
        saved = payload.variant;
        setVariants((current) => [saved, ...current]); openVariant(saved);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo guardar la variante."); }
    finally { setSaving(false); }
  }
  async function deleteVariant() {
    if (!active) return;
    if (!deleteArmed) { setDeleteArmed(true); return; }
    setSaving(true); setError(null);
    try {
      const response = await fetch(`/api/v1/contracts/flow/${flowId}/variants/${active.id}`, { method: "DELETE" });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "No se pudo eliminar la variante.");
      const remaining = variants.filter((variant) => variant.id !== active.id); setVariants(remaining);
      if (remaining[0]) openVariant(remaining[0]); else startNew();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo eliminar la variante."); }
    finally { setSaving(false); }
  }

  const fieldIndex = (fieldKey: string) => fields.findIndex((field) => field.fieldKey === fieldKey);
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-3 sm:p-6" onMouseDown={onClose}>
      <section className="flex h-[min(900px,94vh)] w-full max-w-[1320px] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl" onMouseDown={(event) => event.stopPropagation()} aria-label="Entrenamiento visual de extracción">
        <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3 sm:px-5">
          <div className="min-w-0 mr-auto"><p className="text-[11px] font-medium uppercase tracking-[0.08em] text-primary">Entrenamiento visual</p><h2 className="truncate text-sm font-semibold text-foreground">{documentName}</h2></div>
          <span className="hidden rounded-full bg-secondary px-2.5 py-1 text-[11px] text-muted-foreground sm:inline">{fields.length} campos configurados</span>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label="Cerrar"><X className="h-4 w-4" /></button>
        </header>

        <div className="flex min-h-0 flex-1">
          <main className="flex min-w-0 flex-1 flex-col bg-[oklch(0.965_0.006_258)]">
            <div className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-3 py-2">
              {isPdf && <><button onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1} className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary disabled:opacity-30" aria-label="Página anterior"><ChevronLeft className="h-4 w-4" /></button><span className="w-12 text-center text-[11px] tabular-nums text-muted-foreground">{page}/{pages || "—"}</span><button onClick={() => setPage((value) => Math.min(pages || 1, value + 1))} disabled={!pages || page >= pages} className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary disabled:opacity-30" aria-label="Página siguiente"><ChevronRight className="h-4 w-4" /></button><span className="mx-1 h-4 w-px bg-border" /></>}
              <button onClick={() => setZoom((value) => Math.max(0.65, +(value - 0.15).toFixed(2)))} className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary" aria-label="Alejar"><ZoomOut className="h-3.5 w-3.5" /></button><span className="w-9 text-center text-[11px] tabular-nums text-muted-foreground">{Math.round(zoom * 100)}%</span><button onClick={() => setZoom((value) => Math.min(1.5, +(value + 0.15).toFixed(2)))} className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary" aria-label="Acercar"><ZoomIn className="h-3.5 w-3.5" /></button>
              <span className="ml-auto text-[11px] text-muted-foreground">{activeField ? "Arrastra sobre la ubicación del campo" : "Selecciona un campo para marcar"}</span>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-5 sm:p-7">
              {loading ? <div className="flex h-full items-center justify-center text-xs text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando variantes…</div> : !fileUrl ? <label className="mx-auto flex h-full min-h-80 max-w-lg cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-8 text-center hover:border-primary/50 hover:bg-primary/[0.02]"><FileUp className="mb-3 h-8 w-8 text-primary" /><p className="text-sm font-medium text-foreground">Sube un documento representativo</p><p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">PDF, JPG, PNG o WEBP. Marca una vez dónde vive cada dato para que este formato se extraiga con más precisión.</p><span className="mt-4 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground">Elegir documento</span><input className="sr-only" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => chooseFile(event.target.files?.[0] ?? null)} /></label> : <div className="mx-auto w-fit"><div ref={stageRef} className={`relative select-none overflow-hidden bg-white shadow-[0_3px_20px_oklch(0.18_0.015_258_/_0.18)] ${activeField ? "cursor-crosshair" : "cursor-default"}`} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrawing} onPointerCancel={() => { drawingRef.current = null; setDraft(null); }}>
                {isPdf ? <Document file={fileUrl} onLoadSuccess={(pdf) => { setPages(pdf.numPages); setPage((current) => Math.min(current, pdf.numPages)); extractPdfSignature(pdf); }} loading={<div className="flex h-[640px] w-[460px] items-center justify-center text-xs text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando PDF…</div>} error={<div className="flex h-[340px] w-[460px] items-center justify-center px-6 text-center text-xs text-destructive">No se pudo mostrar el PDF. Puedes volver a subir el documento.</div>}><Page pageNumber={page} width={Math.round(510 * zoom)} renderTextLayer={false} renderAnnotationLayer={false} /></Document> : <img src={fileUrl} alt={safeFileName(newFile?.name ?? active?.originalName ?? null)} draggable={false} style={{ display: "block", width: Math.round(510 * zoom), height: "auto" }} />}
                <div className="absolute inset-0">{currentMappings.map((mapping) => { const index = fieldIndex(mapping.fieldKey); const colour = colourAt(Math.max(0, index)); const field = fieldByKey.get(mapping.fieldKey); return <button key={mapping.fieldKey} onClick={(event) => { event.stopPropagation(); setActiveField(mapping.fieldKey); }} style={{ position: "absolute", left: `${mapping.x * 100}%`, top: `${mapping.y * 100}%`, width: `${mapping.width * 100}%`, height: `${mapping.height * 100}%`, border: `2px solid ${colour.stroke}`, background: colour.fill }} className="group rounded-sm text-left outline-none"><span style={{ background: colour.stroke }} className="absolute -top-5 left-0 max-w-40 truncate rounded px-1.5 py-0.5 text-[10px] font-medium text-white opacity-0 shadow-sm transition-opacity group-hover:opacity-100">{field?.label ?? mapping.fieldKey}</span></button>; })}{draft && <div style={{ position: "absolute", left: `${draft.x * 100}%`, top: `${draft.y * 100}%`, width: `${draft.width * 100}%`, height: `${draft.height * 100}%`, border: "2px dashed var(--color-primary)", background: "oklch(0.48 0.15 182 / 0.15)" }} />}</div>
              </div></div>}
            </div>
          </main>

          <aside className="hidden w-[336px] shrink-0 flex-col border-l border-border bg-card lg:flex">
            <div className="border-b border-border p-4"><div className="flex items-center justify-between gap-2"><div><h3 className="text-sm font-semibold text-foreground">Campos de {documentName}</h3><p className="mt-0.5 text-[11px] text-muted-foreground">Elige uno y dibuja su zona.</p></div><span className="rounded-full bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary">{coverage}%</span></div><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${coverage}%` }} /></div></div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3"><div className="space-y-1">{fields.map((field, index) => { const mapping = mappings.find((entry) => entry.fieldKey === field.fieldKey); const colour = colourAt(index); const selected = activeField === field.fieldKey; return <button key={field.fieldKey} onClick={() => setActiveField(field.fieldKey)} className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors ${selected ? "border-primary bg-primary/[0.045]" : "border-transparent hover:bg-secondary/70"}`}><span style={{ background: mapping ? colour.stroke : "var(--color-border)" }} className="h-2.5 w-2.5 rounded-full" /><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-foreground">{field.label || field.fieldKey}</span><span className="block truncate text-[10px] text-muted-foreground">{mapping ? `Página ${mapping.page}${mapping.anchorText ? " · ancla guardada" : " · zona marcada"}` : "Sin ubicar"}</span></span>{mapping && <span onClick={(event) => { event.stopPropagation(); removeMapping(field.fieldKey); }} className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="Quitar marca"><X className="h-3.5 w-3.5" /></span>}</button>; })}</div></div>
            <div className="border-t border-border p-3"><p className="mb-2 text-[10px] font-medium uppercase tracking-[0.07em] text-muted-foreground">Variantes de formato</p><div className="space-y-1">{variants.map((variant) => <button key={variant.id} onClick={() => openVariant(variant)} className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left ${variant.id === activeId ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/60"}`}><Eye className="h-3.5 w-3.5 shrink-0" /><span className="min-w-0 flex-1 truncate text-[11px]">{variant.name}</span><span className="text-[10px]">{Array.isArray(variant.mappings) ? variant.mappings.length : 0}/{fields.length}</span></button>)}<button onClick={startNew} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] font-medium text-primary hover:bg-primary/[0.045]"><Plus className="h-3.5 w-3.5" /> Nueva variante</button></div></div>
          </aside>
        </div>

        <footer className="flex shrink-0 items-center gap-3 border-t border-border bg-card px-4 py-3 sm:px-5"><div className="min-w-0 mr-auto"><input value={variantName} onChange={(event) => setVariantName(event.target.value)} className="w-full max-w-[320px] border-0 bg-transparent text-xs font-medium text-foreground outline-none placeholder:text-muted-foreground" placeholder="Nombre de la variante" /><p className="mt-0.5 text-[10px] text-muted-foreground">{active ? `${mappings.length} zona(s) marcada(s) en ${safeFileName(active.originalName)}` : newFile ? newFile.name : "La muestra se guarda privada dentro de este tenant."}</p></div>{error && <p className="max-w-64 text-right text-[11px] leading-snug text-destructive">{error}</p>}{active && <button onClick={deleteVariant} disabled={saving} className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-2 text-xs font-medium transition-colors ${deleteArmed ? "bg-destructive text-destructive-foreground" : "text-muted-foreground hover:bg-destructive/10 hover:text-destructive"}`}>{deleteArmed ? <><Trash2 className="h-3.5 w-3.5" /> Confirmar eliminar</> : <><Trash2 className="h-3.5 w-3.5" /> Eliminar</>}</button>}<button onClick={save} disabled={saving || loading} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-xs font-medium text-primary-foreground shadow-[0_1px_3px_oklch(0.48_0.15_182_/_0.25)] transition-colors hover:bg-primary/90 disabled:opacity-50">{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}{active ? "Guardar cambios" : "Guardar variante"}</button></footer>
      </section>
    </div>
  );
}
