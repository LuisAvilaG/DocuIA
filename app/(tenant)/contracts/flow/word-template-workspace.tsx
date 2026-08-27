"use client";

import { useEffect, useRef, useState } from "react";
import { Check, FileUp, Link2, Loader2, Trash2, X } from "lucide-react";
import type { DocEditorField } from "./doc-editor";
import type { WordTemplateConfig, WordTemplateMapping } from "@/lib/contracts/word-template";

function highlightMappings(root: HTMLElement, mappings: WordTemplateMapping[]) {
  const anchors = [...new Set(mappings.map((mapping) => mapping.anchorText).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!anchors.length) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    const text = node.nodeValue ?? "";
    const anchor = anchors.find((candidate) => text.includes(candidate));
    if (!anchor || !node.parentElement || node.parentElement.closest("[data-word-mapping]")) continue;
    const fragment = document.createDocumentFragment();
    const before = text.slice(0, text.indexOf(anchor));
    const after = text.slice(text.indexOf(anchor) + anchor.length);
    if (before) fragment.append(document.createTextNode(before));
    const mark = document.createElement("mark");
    mark.dataset.wordMapping = "true";
    mark.className = "rounded bg-primary/15 px-0.5 ring-1 ring-primary/30";
    mark.textContent = anchor;
    fragment.append(mark);
    if (after) fragment.append(document.createTextNode(after));
    node.parentNode?.replaceChild(fragment, node);
  }
}

export function WordTemplateWorkspace({ flowId, nodeId, fields, initialTemplate, onSave, onClose }: {
  flowId: string;
  nodeId: string;
  fields: DocEditorField[];
  initialTemplate?: WordTemplateConfig;
  onSave: (template: WordTemplateConfig) => void;
  onClose: () => void;
}) {
  const previewRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [template, setTemplate] = useState<WordTemplateConfig | undefined>(initialTemplate);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectedText, setSelectedText] = useState("");
  const [selectedField, setSelectedField] = useState(fields[0]?.key ?? "");
  const [loading, setLoading] = useState(Boolean(initialTemplate));
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => { if (previewUrl?.startsWith("blob:")) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  useEffect(() => {
    if (!initialTemplate) return;
    let cancelled = false;
    fetch(`/api/v1/contracts/flow/${flowId}/word-template?nodeId=${encodeURIComponent(nodeId)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("No fue posible cargar la plantilla Word.");
        return response.blob();
      })
      .then((blob) => { if (!cancelled) setPreviewUrl(URL.createObjectURL(blob)); })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "No fue posible cargar la plantilla."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [flowId, initialTemplate, nodeId]);

  useEffect(() => {
    if (!previewUrl || !previewRef.current) return;
    let cancelled = false;
    const host = previewRef.current;
    setLoading(true);
    fetch(previewUrl)
      .then((response) => response.arrayBuffer())
      .then(async (buffer) => {
        const { renderAsync } = await import("docx-preview");
        if (cancelled) return;
        host.replaceChildren();
        await renderAsync(buffer, host, undefined, { inWrapper: true, ignoreWidth: false, ignoreHeight: false });
        if (!cancelled) highlightMappings(host, template?.mappings ?? []);
      })
      .catch(() => { if (!cancelled) setError("No pudimos mostrar esta plantilla. Puedes cargar otro archivo .docx."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [previewUrl, template?.mappings]);

  const upload = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".docx")) {
      setError("Carga un archivo Word .docx.");
      return;
    }
    setError(null); setUploading(true);
    try {
      const form = new FormData(); form.set("file", file); form.set("nodeId", nodeId);
      const response = await fetch(`/api/v1/contracts/flow/${flowId}/word-template`, { method: "POST", body: form });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error ?? "No fue posible cargar la plantilla.");
      setTemplate(json.wordTemplate as WordTemplateConfig);
      setPreviewUrl(URL.createObjectURL(file));
      setSelectedText("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No fue posible cargar la plantilla."); }
    finally { setUploading(false); }
  };

  const captureSelection = () => {
    const selection = window.getSelection();
    const text = selection?.toString().replace(/\s+/g, " ").trim() ?? "";
    if (text) setSelectedText(text.slice(0, 500));
  };
  const addMapping = () => {
    if (!template || !selectedText || !selectedField) return;
    const field = fields.find((item) => item.key === selectedField);
    if (!field) return;
    const next: WordTemplateMapping = { id: crypto.randomUUID(), anchorText: selectedText, fieldKey: field.key, fieldLabel: field.label };
    setTemplate({ ...template, mappings: [...template.mappings.filter((item) => item.fieldKey !== field.key), next] });
    setSelectedText("");
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/45 p-3 sm:p-5" onMouseDown={onClose}>
      <div className="mx-auto flex h-full max-w-[1500px] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <header className="flex items-center justify-between gap-4 border-b border-border px-5 py-3">
          <div><h2 className="text-sm font-semibold">Plantilla Word y mapeo de campos</h2><p className="mt-0.5 text-xs text-muted-foreground">Conserva el diseño corporativo y vincula el texto visible con los datos del caso.</p></div>
          <div className="flex items-center gap-2"><button onClick={() => template && onSave(template)} disabled={!template} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50"><Check className="h-3.5 w-3.5" /> Usar en el flujo</button><button onClick={onClose} className="rounded-md p-2 text-muted-foreground hover:bg-secondary"><X className="h-4 w-4" /></button></div>
        </header>
        <div className="grid min-h-0 flex-1 grid-cols-[250px_minmax(0,1fr)_280px]">
          <aside className="overflow-y-auto border-r border-border p-4">
            <p className="text-xs font-semibold">Campos disponibles</p><p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">Selecciona un campo y luego vincúlalo al texto seleccionado en el Word.</p>
            <div className="mt-3 space-y-1.5">{fields.map((field) => <button key={field.key} onClick={() => setSelectedField(field.key)} className={`w-full rounded-lg border px-2.5 py-2 text-left text-xs transition-colors ${selectedField === field.key ? "border-primary bg-primary/5 text-primary" : "border-border hover:bg-secondary"}`}><span className="block truncate font-medium">{field.label}</span><span className="block truncate pt-0.5 font-mono text-[10px] text-muted-foreground">{field.key}</span></button>)}</div>
          </aside>
          <main className="relative min-w-0 overflow-auto bg-secondary/35 p-6">
            {!template ? <div className="mx-auto flex h-full max-w-xl flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card p-8 text-center"><FileUp className="h-8 w-8 text-primary" /><h3 className="mt-3 text-sm font-semibold">Carga una plantilla Word</h3><p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">Sube el .docx que ya usa tu cliente. Su estilo, tablas, imágenes y estructura se preservarán en el documento final.</p><button onClick={() => inputRef.current?.click()} disabled={uploading} className="mt-5 inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground">{uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileUp className="h-3.5 w-3.5" />} Cargar Word</button></div> : <><div className="mb-3 flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2 text-xs"><span className="truncate font-medium">{template.originalName}</span><button onClick={() => inputRef.current?.click()} className="text-primary hover:underline">Reemplazar</button></div><div ref={previewRef} onMouseUp={captureSelection} className="word-preview mx-auto min-h-full max-w-[820px] bg-white shadow-sm [&_.docx-wrapper]:bg-transparent [&_.docx-wrapper]:p-0" />{loading && <div className="absolute inset-0 grid place-items-center bg-card/60"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>}</>}
            <input ref={inputRef} type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.currentTarget.value = ""; }} />
          </main>
          <aside className="overflow-y-auto border-l border-border p-4">
            <p className="text-xs font-semibold">Vínculos de la plantilla</p>
            {selectedText ? <div className="mt-3 rounded-lg border border-primary/30 bg-primary/5 p-3"><p className="text-[10px] font-semibold uppercase tracking-wide text-primary">Texto seleccionado</p><p className="mt-1 text-xs leading-relaxed">“{selectedText}”</p><button onClick={addMapping} disabled={!selectedField || !template} className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-2.5 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50"><Link2 className="h-3.5 w-3.5" /> Vincular campo</button></div> : <p className="mt-3 rounded-lg border border-dashed border-border p-3 text-[11px] leading-relaxed text-muted-foreground">Selecciona un texto que hoy sea un ejemplo, etiqueta o espacio reservado en el documento.</p>}
            <div className="mt-4 space-y-2">{template?.mappings.map((mapping) => <div key={mapping.id} className="rounded-lg border border-border p-2.5"><div className="flex items-start justify-between gap-2"><p className="min-w-0 truncate text-xs font-medium">{mapping.fieldLabel}</p><button onClick={() => setTemplate({ ...template, mappings: template.mappings.filter((item) => item.id !== mapping.id) })} className="shrink-0 text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button></div><p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">Reemplaza: “{mapping.anchorText}”</p></div>)}</div>
            {template && !template.mappings.length && <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">Aún no hay campos vinculados. El documento se generará igual, pero conservará el texto original.</p>}
            {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
          </aside>
        </div>
        <footer className="border-t border-border px-5 py-2 text-[11px] text-muted-foreground">Al elegir <strong className="font-medium text-foreground">Usar en el flujo</strong>, el mapeo queda aplicado en este nodo. Después guarda el flujo para publicarlo.</footer>
      </div>
    </div>
  );
}
