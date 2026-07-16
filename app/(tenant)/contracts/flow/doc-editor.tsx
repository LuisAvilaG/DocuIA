"use client";

import { useRef, useState, useEffect } from "react";
import {
  X, Save, Bold, Italic, Underline, Strikethrough, List, ListOrdered,
  AlignLeft, AlignCenter, AlignRight, Table as TableIcon, Image as ImageIcon,
  Undo2, Redo2, Highlighter, Baseline,
} from "lucide-react";

const TEXT_COLORS = ["#1a1a1a", "#0f4c81", "#0b7285", "#c92a2a", "#e67700", "#2b8a3e", "#5f3dc4"];
const HL_COLORS = ["#fff3bf", "#d3f9d8", "#ffe3e3", "#e7f5ff", "#f3d9fa"];

// Hoisted (not created during render) so React keeps toolbar identity stable.
function Btn({ title, onClick, children, active }: { title: string; onClick: () => void; children: React.ReactNode; active?: boolean }) {
  return (
    <button type="button" title={title} onMouseDown={(e) => e.preventDefault()} onClick={onClick}
      className={`h-8 w-8 flex items-center justify-center rounded hover:bg-secondary text-muted-foreground hover:text-foreground ${active ? "bg-secondary text-foreground" : ""}`}>{children}</button>
  );
}
function Sep() { return <span className="w-px h-5 bg-border mx-0.5" />; }

// Word-like WYSIWYG editor in a full-screen modal. Stores HTML; the PDF is
// rendered from that HTML server-side. contentEditable is uncontrolled (mounted
// once) so React never fights the cursor.
export function DocEditor({ initialHtml, fields, onSave, onClose }: {
  initialHtml: string; fields: string[]; onSave: (html: string) => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(2);
  const [tableOpen, setTableOpen] = useState(false);

  useEffect(() => { try { document.execCommand("styleWithCSS", false, "true"); } catch { /* noop */ } }, []);

  const cmd = (c: string, v?: string) => { document.execCommand(c, false, v); ref.current?.focus(); };
  const insert = (html: string) => cmd("insertHTML", html);

  const insertTable = () => {
    const r = Math.max(1, Math.min(20, rows)), c = Math.max(1, Math.min(8, cols));
    let t = '<table style="border-collapse:collapse;width:100%;margin:8px 0"><tbody>';
    for (let i = 0; i < r; i++) {
      t += "<tr>";
      for (let j = 0; j < c; j++) {
        const head = i === 0;
        t += `<td style="border:1px solid #ccc;padding:6px;${head ? "background:#f1f3f5;font-weight:600;" : ""}">${head ? "Encabezado" : "&nbsp;"}</td>`;
      }
      t += "</tr>";
    }
    t += "</tbody></table><p></p>";
    insert(t);
    setTableOpen(false);
  };

  const onImage = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => insert(`<img src="${String(reader.result)}" style="max-width:100%;margin:6px 0"/>`);
    reader.readAsDataURL(file);
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onMouseDown={onClose}>
      <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-4xl h-[92vh] flex flex-col overflow-hidden" onMouseDown={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
          <p className="text-sm font-semibold text-foreground">Editor del documento</p>
          <div className="flex items-center gap-2">
            <button onClick={() => onSave(ref.current?.innerHTML ?? "")} className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium hover:bg-primary/90"><Save className="w-3.5 h-3.5" /> Guardar y cerrar</button>
            <button onClick={onClose} className="h-8 w-8 flex items-center justify-center rounded hover:bg-secondary text-muted-foreground"><X className="w-4 h-4" /></button>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-0.5 flex-wrap px-3 py-1.5 border-b border-border shrink-0 bg-secondary/30">
          <Btn title="Deshacer" onClick={() => cmd("undo")}><Undo2 className="w-4 h-4" /></Btn>
          <Btn title="Rehacer" onClick={() => cmd("redo")}><Redo2 className="w-4 h-4" /></Btn>
          <Sep />
          <select onMouseDown={(e) => e.stopPropagation()} onChange={(e) => { cmd("formatBlock", e.target.value); e.target.selectedIndex = 0; }}
            className="h-8 rounded border border-border bg-card px-1.5 text-xs text-foreground">
            <option>Estilo</option>
            <option value="<h1>">Título 1</option>
            <option value="<h2>">Título 2</option>
            <option value="<h3>">Título 3</option>
            <option value="<p>">Normal</option>
          </select>
          <Sep />
          <Btn title="Negrita" onClick={() => cmd("bold")}><Bold className="w-4 h-4" /></Btn>
          <Btn title="Cursiva" onClick={() => cmd("italic")}><Italic className="w-4 h-4" /></Btn>
          <Btn title="Subrayado" onClick={() => cmd("underline")}><Underline className="w-4 h-4" /></Btn>
          <Btn title="Tachado" onClick={() => cmd("strikeThrough")}><Strikethrough className="w-4 h-4" /></Btn>
          <Sep />
          {/* Text color */}
          <div className="flex items-center gap-0.5" title="Color de texto">
            <Baseline className="w-3.5 h-3.5 text-muted-foreground" />
            {TEXT_COLORS.map((c) => <button key={c} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd("foreColor", c)} style={{ background: c }} className="w-4 h-4 rounded-sm border border-black/10" />)}
          </div>
          <Sep />
          {/* Highlight */}
          <div className="flex items-center gap-0.5" title="Resaltado">
            <Highlighter className="w-3.5 h-3.5 text-muted-foreground" />
            {HL_COLORS.map((c) => <button key={c} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd("hiliteColor", c)} style={{ background: c }} className="w-4 h-4 rounded-sm border border-black/10" />)}
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd("hiliteColor", "transparent")} className="text-[9px] text-muted-foreground px-1">quitar</button>
          </div>
          <Sep />
          <Btn title="Alinear izquierda" onClick={() => cmd("justifyLeft")}><AlignLeft className="w-4 h-4" /></Btn>
          <Btn title="Centrar" onClick={() => cmd("justifyCenter")}><AlignCenter className="w-4 h-4" /></Btn>
          <Btn title="Alinear derecha" onClick={() => cmd("justifyRight")}><AlignRight className="w-4 h-4" /></Btn>
          <Sep />
          <Btn title="Lista con viñetas" onClick={() => cmd("insertUnorderedList")}><List className="w-4 h-4" /></Btn>
          <Btn title="Lista numerada" onClick={() => cmd("insertOrderedList")}><ListOrdered className="w-4 h-4" /></Btn>
          <Sep />
          <div className="relative">
            <Btn title="Insertar tabla" onClick={() => setTableOpen((o) => !o)} active={tableOpen}><TableIcon className="w-4 h-4" /></Btn>
            {tableOpen && (
              <div className="absolute top-9 right-0 z-10 bg-popover border border-border rounded-md shadow-lg p-2 flex items-center gap-1.5" onMouseDown={(e) => e.stopPropagation()}>
                <label className="text-[10px] text-muted-foreground">Filas<input type="number" min={1} max={20} value={rows} onChange={(e) => setRows(Number(e.target.value))} className="ml-1 w-12 border border-border rounded px-1 py-0.5 text-xs bg-card" /></label>
                <label className="text-[10px] text-muted-foreground">Cols<input type="number" min={1} max={8} value={cols} onChange={(e) => setCols(Number(e.target.value))} className="ml-1 w-12 border border-border rounded px-1 py-0.5 text-xs bg-card" /></label>
                <button onClick={insertTable} className="rounded bg-primary text-primary-foreground px-2 py-1 text-[10px] font-medium">Insertar</button>
              </div>
            )}
          </div>
          <Btn title="Insertar imagen / logo" onClick={() => fileRef.current?.click()}><ImageIcon className="w-4 h-4" /></Btn>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => e.target.files?.[0] && onImage(e.target.files[0])} />
          <Sep />
          <select onMouseDown={(e) => e.stopPropagation()} onChange={(e) => { if (e.target.value) cmd("insertText", `{{${e.target.value}}}`); e.target.selectedIndex = 0; }}
            className="h-8 rounded border border-border bg-card px-1.5 text-xs text-primary max-w-[160px]" title="Insertar campo del caso">
            <option value="">+ Insertar campo</option>
            {fields.map((f) => <option key={f} value={f}>{`{{${f}}}`}</option>)}
          </select>
        </div>

        {/* Editable page */}
        <div className="flex-1 overflow-y-auto bg-secondary/40 p-6">
          <style>{`.doc-page{font-family:'Plus Jakarta Sans',system-ui,sans-serif;color:#1a1a1a;font-size:13px;line-height:1.6}
.doc-page:focus{outline:none}
.doc-page h1{font-size:1.6em;font-weight:700;margin:.4em 0}
.doc-page h2{font-size:1.3em;font-weight:700;margin:.4em 0}
.doc-page h3{font-size:1.1em;font-weight:600;margin:.3em 0}
.doc-page p{margin:.35em 0}
.doc-page ul{list-style:disc;padding-left:1.4em;margin:.4em 0}
.doc-page ol{list-style:decimal;padding-left:1.4em;margin:.4em 0}
.doc-page table{border-collapse:collapse}
.doc-page td,.doc-page th{border:1px solid #ccc;padding:6px}
.doc-page img{max-width:100%}`}</style>
          <div ref={ref} contentEditable suppressContentEditableWarning
            className="doc-page bg-white mx-auto shadow-sm rounded-sm"
            style={{ width: "100%", maxWidth: 760, minHeight: 900, padding: "56px 64px" }}
            dangerouslySetInnerHTML={{ __html: initialHtml || "<h1>Documento</h1><p>Escribe aquí. Usa la barra para dar formato e inserta campos del caso con “+ Insertar campo”.</p>" }} />
        </div>
      </div>
    </div>
  );
}
