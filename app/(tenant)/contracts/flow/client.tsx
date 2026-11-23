"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ReactFlow, Background, Controls, MiniMap, ReactFlowProvider, useReactFlow,
  useNodesState, useEdgesState, addEdge, Handle, NodeResizer, Position, MarkerType,
  type Node, type Edge, type Connection, type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Loader2, Save, Plus, Trash2, ArrowLeft, X, ClipboardCheck, FileInput, ListChecks, Calculator, ShieldCheck, FileText, FileSearch, ChevronDown, ChevronUp, StickyNote, PencilRuler, Sparkles, BookMarked, FileUp, PanelLeft,
} from "lucide-react";
import { ApprovalForm } from "./approval-form";
import { RuleFromText } from "./rule-from-text";
import { FieldNamesContext, useFieldName, type FieldNames } from "./field-names";
import { btn, StatusPill } from "@/components/kit";
import { DocEditor } from "./doc-editor";
import { VisualTrainingWorkspace, type TrainingField } from "./visual-training-workspace";
import { WordTemplateWorkspace } from "./word-template-workspace";
import { HistoryDrawer, PublishDrawer, TestDrawer, type FlowTestRow, type FlowVersionRow } from "./versions-panel";
import { diffFlows } from "@/lib/contracts/flow-diff";
import type { FlowGraph } from "@/lib/contracts/flow";
import type { WordTemplateConfig } from "@/lib/contracts/word-template";

// Seed the WYSIWYG editor from stored HTML, else migrate the old text body, else blank.
function genInitialHtml(data: Record<string, unknown>): string {
  if (typeof data.html === "string" && data.html.trim()) return data.html;
  const body = typeof data.body === "string" ? data.body : "";
  if (body.trim()) return body.split("\n").map((l) => `<p>${l.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`).join("");
  return "";
}

// ── Node kinds ────────────────────────────────────────────────────────
type Kind = "intake" | "extract" | "calculate" | "validate" | "reference_lookup" | "generate" | "approval" | "note";

const KIND_META: Record<Kind, { title: string; hint: string; Icon: typeof FileInput; hasIn: boolean; hasOut: boolean }> = {
  intake:   { title: "Documento esperado", hint: "Qué sube el usuario",       Icon: FileInput,   hasIn: false, hasOut: true },
  extract:  { title: "Extracción", hint: "Datos que lee la IA",       Icon: ListChecks,  hasIn: true,  hasOut: true },
  calculate:{ title: "Cálculo",    hint: "Primas, porcentajes, sumas", Icon: Calculator,   hasIn: true,  hasOut: true },
  validate: { title: "Control",    hint: "Una regla que se cumple o no",  Icon: ShieldCheck, hasIn: true,  hasOut: true },
  reference_lookup: { title: "Búsqueda en el Archivo", hint: "Documentos que cita el caso", Icon: FileSearch, hasIn: true, hasOut: true },
  generate: { title: "Documento a generar", hint: "Word o PDF al aprobar",            Icon: FileText,    hasIn: true,  hasOut: false },
  approval: { title: "Aprobación", hint: "Quién decide y cuándo", Icon: ClipboardCheck, hasIn: true, hasOut: true },
  note:     { title: "Nota",       hint: "Comentario para el equipo",  Icon: StickyNote,  hasIn: false, hasOut: false },
};

type AnyData = Record<string, unknown>;

function defaultData(kind: Kind): AnyData {
  switch (kind) {
    case "intake":   return { docTypeKey: "nuevo_tipo", name: "Nuevo documento", hint: "" };
    case "extract":  return { docTypeKey: "nuevo_tipo", fields: [] };
    case "calculate": return { name: "Nuevo cálculo", key: "resultado_calculado", label: "Resultado calculado", base: { type: "field", docType: "", field: "" }, operation: "percentage", operand: { type: "number", value: 10 }, decimals: 0, fixedValues: [], mode: "single" };
    case "validate": return { name: "Nueva validación", rule: {
      kind: "cross_reference",
      subjects: { docType: "", field: "" },
      membership: { docType: "", field: "", label: "En documento" },
      statusLabels: { pass: "vigente", fail: "no_vigente", unknown: "indeterminado" },
    } };
    case "reference_lookup": return { name: "Rastreo de referencias", severity: "warn" };
    case "generate": return { templateKey: "salida", name: "Documento de salida", body: "", source: "editor" };
    case "approval": return { name: "Aprobación", base: { mode: "any", userIds: [] }, conditions: [], exceptionUserIds: [] };
    case "note":     return { body: "Escribe aquí la instrucción o comentario para este flujo." };
  }
}

const handleStyle = { width: 9, height: 9, background: "var(--color-primary)", border: "2px solid var(--color-card)" } as const;

// ── Canvas node renderer ──────────────────────────────────────────────
function NodeCard({ type, data, selected }: NodeProps) {
  const meta = KIND_META[(type as Kind)] ?? KIND_META.intake;
  const d = data as AnyData;
  const Icon = meta.Icon;
  const order = typeof d._order === "number" ? d._order : null;
  const onNoteChange = typeof d._onNoteChange === "function" ? d._onNoteChange as (body: string) => void : null;
  if (type === "note") {
    return (
      <>
        <NodeResizer
          isVisible={!!selected}
          minWidth={230}
          minHeight={126}
          maxWidth={680}
          maxHeight={520}
          color="var(--color-warning)"
          handleStyle={{ width: 10, height: 10, borderRadius: 3, background: "var(--color-card)", border: "2px solid var(--color-warning)" }}
          lineStyle={{ opacity: 0.55 }}
        />
        <div className={`flex h-full min-h-[126px] min-w-[230px] w-full flex-col rounded-lg border p-3 transition-shadow ${selected ? "border-warning ring-2 ring-warning/20 shadow-[0_4px_16px_oklch(0.18_0.015_258_/_0.10)]" : "border-warning/35 bg-warning/10 hover:shadow-[0_2px_8px_oklch(0.18_0.015_258_/_0.06)]"}`}>
        <div className="mb-2 flex shrink-0 items-center gap-1.5 text-warning">
          <StickyNote className="h-3.5 w-3.5" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.06em]">Nota de flujo</span>
        </div>
        <textarea className="nodrag nopan min-h-[58px] w-full flex-1 resize-none bg-transparent text-xs leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/70"
          value={String(d.body ?? "")} rows={4} placeholder="Escribe una instrucción para la demo…"
          onChange={(e) => onNoteChange?.(e.target.value)} onMouseDown={(e) => e.stopPropagation()} />
        </div>
      </>
    );
  }
  const summary =
    type === "intake"   ? String(d.name || d.docTypeKey || "Sin nombre") :
    type === "extract"  ? `${String(d.docTypeKey || "—")} · ${Array.isArray(d.fields) ? d.fields.length : 0} campos` :
    type === "calculate" ? String(d.label || d.name || "Sin nombre") :
    type === "validate" ? String(d.name || "Sin nombre") :
    type === "reference_lookup" ? String(d.name || "Rastreo de referencias") :
                          String(d.name || d.templateKey || "Sin nombre");
  return (
    <div className={`rounded-lg border bg-card min-w-[184px] max-w-[220px] overflow-hidden transition-shadow ${selected ? "border-primary ring-2 ring-primary/25 shadow-[0_4px_16px_oklch(0.18_0.015_258_/_0.10)]" : "border-border hover:shadow-[0_2px_8px_oklch(0.18_0.015_258_/_0.06)]"}`}>
      {meta.hasIn && <Handle type="target" position={Position.Left} style={handleStyle} />}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/60">
        <span className="w-6 h-6 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0"><Icon className="w-3.5 h-3.5" /></span>
        <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{meta.title}</span>
        {type === "intake" && order != null && <span className="ml-auto text-[10px] font-semibold text-primary tabular-nums">#{order}</span>}
      </div>
      <div className="px-3 py-2 text-xs text-foreground leading-snug truncate">{summary}</div>
      {meta.hasOut && <Handle type="source" position={Position.Right} style={handleStyle} />}
    </div>
  );
}

// ── Side-panel forms ──────────────────────────────────────────────────
// One vocabulary for every stage form, the same as the approval form's: a label
// that names the field, a line under it saying what it is for, and a heading
// over each column of a repeated row. An input that only carries a placeholder
// stops saying what it is the moment it has a value.
const inp = "w-full min-h-9 rounded-lg border border-border bg-card px-2.5 py-1.5 text-[13px] text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15";
const lbl = "block text-[13px] font-semibold text-foreground";
const hlp = "block text-xs leading-relaxed text-muted-foreground";
const colHead = "text-[11.5px] font-medium leading-tight text-muted-foreground";
const box = "rounded-[10px] border border-border bg-background p-3";
const check = "mt-0.5 size-4 shrink-0 accent-primary";
const addBtn = "inline-flex items-center gap-1.5 self-start text-[13px] font-semibold text-link hover:underline";
const removeBtn = "flex size-6 shrink-0 items-center justify-center self-center rounded text-muted-foreground hover:text-tone-err";

function FieldRow({ label, help, children }: { label: string; help?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span><span className={lbl}>{label}</span>{help && <span className={`${hlp} mt-0.5`}>{help}</span>}</span>
      {children}
    </label>
  );
}

/** A group of controls under one title, for fields that are not a single input. */
function FieldGroup({ label, help, children }: { label: string; help?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div><span className={lbl}>{label}</span>{help && <span className={`${hlp} mt-0.5`}>{help}</span>}</div>
      {children}
    </div>
  );
}

/** "Número del contrato" → "numero_del_contrato": the key a name gets when none was typed. */
function keyFrom(name: string): string {
  return name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
}

interface DocTypeOpt { key: string; name: string }

function IntakeForm({ data, patch, order, total, onMove }: { data: AnyData; patch: (p: AnyData) => void; order?: number; total?: number; onMove?: (dir: -1 | 1) => void }) {
  return (
    <div className="flex flex-col gap-4">
      {order != null && total != null && total > 1 && (
        <div className={`${box} flex items-center justify-between !py-2`}>
          <span className="text-[13px] text-muted-foreground">Se pide en el lugar <span className="font-semibold text-foreground tabular-nums">{order}</span> de {total}</span>
          <span className="flex items-center gap-1">
            <button type="button" onClick={() => onMove?.(-1)} disabled={order <= 1} className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-30" aria-label="Pedirlo antes" title="Pedirlo antes"><ChevronUp className="size-4" /></button>
            <button type="button" onClick={() => onMove?.(1)} disabled={order >= total} className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-30" aria-label="Pedirlo después" title="Pedirlo después"><ChevronDown className="size-4" /></button>
          </span>
        </div>
      )}
      <FieldRow label="Nombre del documento" help="Así lo ve quien crea el caso, en la casilla donde lo sube.">
        <input className={inp} value={String(data.name ?? "")} onChange={(e) => patch({ name: e.target.value })} placeholder="Ej. Contrato" />
      </FieldRow>
      <FieldRow label="Clave interna" help="Identificador corto, sin espacios. Con él las demás etapas saben de qué documento hablas; si lo cambias, vuelve a elegir el documento en ellas.">
        <input className={`${inp} font-mono !text-xs`} value={String(data.docTypeKey ?? "")} onChange={(e) => patch({ docTypeKey: e.target.value })} placeholder="contrato" />
      </FieldRow>
      <FieldRow label="Descripción para la IA (opcional)" help="Una frase que diga qué es. Ayuda a reconocerlo cuando se suben varios archivos juntos.">
        <textarea rows={2} className={inp} value={String(data.hint ?? "")} onChange={(e) => patch({ hint: e.target.value })} placeholder="Ej. Acuerdo comercial entre la sociedad y un tercero" />
      </FieldRow>
      <label className="flex items-start gap-2 text-[13px]">
        <input type="checkbox" className={check} checked={data.required !== false} onChange={(e) => patch({ required: e.target.checked })} />
        <span><span className="font-semibold">Obligatorio al crear el caso</span><span className={hlp}>Si no lo es, su casilla aparece como «Opcional» y el caso se puede crear sin él.</span></span>
      </label>
    </div>
  );
}

interface FieldT { fieldKey: string; label: string; isList: boolean }
const fieldCols = "grid grid-cols-[minmax(0,1fr)_124px_40px_24px] gap-1.5";

function ExtractForm({ data, patch, docTypes, onTrain }: { data: AnyData; patch: (p: AnyData) => void; docTypes: DocTypeOpt[]; onTrain: (input: { documentType: string; documentName: string; fields: TrainingField[] }) => void }) {
  const fields = (Array.isArray(data.fields) ? data.fields : []) as FieldT[];
  const update = (index: number, change: Partial<FieldT>) => patch({ fields: fields.map((field, i) => (i === index ? { ...field, ...change } : field)) });
  const documentType = String(data.docTypeKey ?? "");
  const documentName = docTypes.find((item) => item.key === documentType)?.name || documentType;
  const trainBlocked = !documentType ? "Elige primero el documento." : fields.some((field) => !field.fieldKey) ? "Completa la clave de cada dato." : null;
  return (
    <div className="flex flex-col gap-4">
      <FieldRow label="Documento que se lee" help={docTypes.length ? "Uno de los «Documentos esperados» de este flujo." : "Agrega primero una etapa «Documento esperado»."}>
        <Select value={documentType} onChange={(v) => patch({ docTypeKey: v })}
          options={docTypes.map((d) => ({ value: d.key, label: d.name }))} placeholder="Elige el documento" />
      </FieldRow>

      <FieldGroup label="Datos que se extraen" help="Cada renglón es un dato que la IA busca en el documento.">
        {fields.length > 0 && (
          <div className={`${fieldCols} mt-1`} aria-hidden>
            <span className={colHead}>Nombre del dato</span>
            <span className={colHead}>Clave interna</span>
            <span className={`${colHead} text-center`}>Varios</span>
            <span />
          </div>
        )}
        {fields.map((f, i) => (
          <div key={i} className={fieldCols}>
            <input className={inp} aria-label="Nombre del dato" placeholder="Ej. Número del contrato" value={f.label}
              onChange={(e) => update(i, { label: e.target.value })}
              // A new row gets its key from the name. Only while the key is
              // empty: a key in use is what controls and templates point at.
              onBlur={() => { if (!f.fieldKey.trim() && f.label.trim()) update(i, { fieldKey: keyFrom(f.label) }); }} />
            <input className={`${inp} font-mono !text-xs`} aria-label="Clave interna" placeholder="se llena sola" value={f.fieldKey}
              onChange={(e) => update(i, { fieldKey: e.target.value.replace(/\s+/g, "_") })} />
            <label className="flex items-center justify-center" title="Puede traer varios valores">
              <input type="checkbox" className="size-4 accent-primary" aria-label="Puede traer varios valores" checked={!!f.isList} onChange={(e) => update(i, { isList: e.target.checked })} />
            </label>
            <button type="button" onClick={() => patch({ fields: fields.filter((_, j) => j !== i) })} className={removeBtn} aria-label={`Quitar ${f.label || "este dato"}`} title="Quitar este dato"><Trash2 className="size-4" /></button>
          </div>
        ))}
        <button type="button" onClick={() => patch({ fields: [...fields, { fieldKey: "", label: "", isList: false }] })} className={`${addBtn} mt-0.5`}><Plus className="size-4" />Agregar dato</button>
        <dl className="mt-2 flex flex-col gap-1.5 border-t border-line-soft pt-3 text-xs leading-relaxed text-muted-foreground">
          <div><dt className="inline font-semibold text-foreground/80">Nombre del dato: </dt><dd className="inline">como lo verá tu equipo en el caso.</dd></div>
          <div><dt className="inline font-semibold text-foreground/80">Clave interna: </dt><dd className="inline">identificador sin espacios con el que controles, cálculos y plantillas se refieren al dato. Se llena sola con el nombre; evita cambiarla cuando ya esté en uso.</dd></div>
          <div><dt className="inline font-semibold text-foreground/80">Varios: </dt><dd className="inline">márcalo si el documento puede traer más de uno, como los representantes o las cláusulas.</dd></div>
        </dl>
      </FieldGroup>

      <div className="rounded-[10px] border border-primary/20 bg-primary/[0.035] p-3">
        <p className="flex items-center gap-1.5 text-[13px] font-semibold"><PencilRuler className="size-4 text-primary" />Entrenar con un documento de muestra</p>
        <p className={`${hlp} mt-1`}>Sube una muestra y marca en ella dónde aparece cada dato. Crea otra variante solo cuando cambie el formato del documento.</p>
        <button type="button" disabled={!!trainBlocked} onClick={() => onTrain({ documentType, documentName, fields: fields.filter((field) => field.fieldKey).map((field) => ({ fieldKey: field.fieldKey, label: field.label || field.fieldKey })) })} className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-card px-2.5 py-1.5 text-[13px] font-medium text-primary hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50">Abrir entrenamiento visual</button>
        {trainBlocked && <p className={`${hlp} mt-1.5`}>{trainBlocked}</p>}
      </div>
    </div>
  );
}

const CALC_OPERATIONS = [
  { value: "percentage", label: "Porcentaje de la base" },
  { value: "multiply", label: "Multiplicar por un valor" },
  { value: "add", label: "Sumar un valor" },
  { value: "subtract", label: "Restar un valor" },
  { value: "divide", label: "Dividir entre un valor" },
];

type FixedValue = { key: string; label: string; value: number };
type AnalysisNodeOption = { id: string; name: string };
const fixedCols = "grid grid-cols-[minmax(0,1fr)_96px_76px_24px] gap-1.5";

function CalculationForm({ data, patch, docTypes, fieldsByType, analysisNodes }: { data: AnyData; patch: (p: AnyData) => void; docTypes: DocTypeOpt[]; fieldsByType: Record<string, string[]>; analysisNodes: AnalysisNodeOption[] }) {
  const fieldName = useFieldName();
  const base = (data.base && typeof data.base === "object" ? data.base : {}) as { type?: "field" | "fixed"; docType?: string; field?: string; key?: string };
  const operation = String(data.operation ?? "percentage");
  const fixedValues = (Array.isArray(data.fixedValues) ? data.fixedValues : []) as FixedValue[];
  const mode = data.mode === "each_analysis_item" ? "each_analysis_item" : "single";
  const rawOperand = data.operand;
  const operand = typeof rawOperand === "number" ? { type: "number", value: rawOperand } : (rawOperand && typeof rawOperand === "object" ? rawOperand : { type: "number", value: 0 }) as { type?: string; value?: number; key?: string };
  const fixedName = (key?: string) => fixedValues.find((item) => item.key === key)?.label || key;
  const baseField = base.type === "fixed" ? fixedName(base.key) || "valor fijo" : base.field ? fieldName(base.docType ?? "", base.field) : "valor base";
  const operandName = operand.type === "fixed" ? fixedName(operand.key) || "valor" : operand.type === "item" ? operand.key || "valor" : String(operand.value ?? 0);
  const operatorText = operation === "percentage" ? `× ${operandName}%` : operation === "multiply" ? `× ${operandName}` : operation === "add" ? `+ ${operandName}` : operation === "subtract" ? `− ${operandName}` : `÷ ${operandName}`;
  const setBase = (next: Record<string, unknown>) => patch({ base: { type: base.type ?? "field", docType: base.docType ?? "", field: base.field ?? "", ...next } });
  const setFixed = (values: FixedValue[]) => patch({ fixedValues: values });
  const updateFixed = (index: number, change: Partial<FixedValue>) => setFixed(fixedValues.map((item, i) => (i === index ? { ...item, ...change } : item)));
  const setOperand = (next: Record<string, unknown>) => patch({ operand: next });
  const currentFilter = (data.itemFilter && typeof data.itemFilter === "object" ? data.itemFilter : {}) as { key?: string; value?: string };
  const [filterDraft, setFilterDraft] = useState({ key: currentFilter.key ?? "", value: currentFilter.value ?? "" });
  const setFilter = (part: "key" | "value", value: string) => {
    const next = { ...filterDraft, [part]: value };
    setFilterDraft(next);
    // Do not persist a half-filled optional filter: the flow schema rightly
    // rejects it and users should still be able to save a work-in-progress node.
    patch({ itemFilter: next.key?.trim() && next.value?.trim() ? next : undefined });
  };
  const fixedOptions = fixedValues.filter((item) => item.key).map((item) => ({ value: item.key, label: item.label || item.key }));
  return (
    <div className="flex flex-col gap-4">
      <FieldRow label="Nombre del cálculo" help="Para reconocerlo en el flujo.">
        <input className={inp} value={String(data.name ?? "")} onChange={(event) => patch({ name: event.target.value })} placeholder="Ej. Valor asegurado de seriedad" />
      </FieldRow>
      <div className="flex flex-col gap-1.5">
        <div className="grid grid-cols-2 gap-2">
          <FieldRow label="Nombre del resultado"><input className={inp} value={String(data.label ?? "")} onChange={(event) => patch({ label: event.target.value })} placeholder="Ej. Valor asegurado" /></FieldRow>
          <FieldRow label="Clave interna"><input className={`${inp} font-mono !text-xs`} value={String(data.key ?? "")} onChange={(event) => patch({ key: event.target.value.replace(/\s+/g, "_") })} placeholder="valor_asegurado" /></FieldRow>
        </div>
        <p className={hlp}>El resultado aparece en el caso con ese nombre. La clave, sin espacios, es la que usan las plantillas y otros cálculos.</p>
      </div>

      <div className={`${box} flex flex-col gap-1.5`}>
        <div><span className={lbl}>Valores fijos</span><span className={`${hlp} mt-0.5`}>Números que no vienen del documento: tasas, topes, salario mínimo, UVT. Úsalos abajo como valor base o en la operación.</span></div>
        {fixedValues.length > 0 && (
          <div className={`${fixedCols} mt-1`} aria-hidden><span className={colHead}>Nombre</span><span className={colHead}>Clave interna</span><span className={colHead}>Valor</span><span /></div>
        )}
        {fixedValues.map((value, index) => (
          <div key={index} className={fixedCols}>
            <input className={inp} aria-label="Nombre del valor fijo" value={value.label} placeholder="Ej. Salario mínimo" onChange={(event) => updateFixed(index, { label: event.target.value })}
              onBlur={() => { if (!value.key.trim() && value.label.trim()) updateFixed(index, { key: keyFrom(value.label) }); }} />
            <input className={`${inp} font-mono !text-xs`} aria-label="Clave interna" value={value.key} placeholder="se llena sola" onChange={(event) => updateFixed(index, { key: event.target.value.replace(/\s+/g, "_") })} />
            <input className={`${inp} tabular-nums`} aria-label="Valor" type="number" step="any" value={Number.isFinite(value.value) ? value.value : ""} onChange={(event) => updateFixed(index, { value: Number(event.target.value) })} />
            <button type="button" onClick={() => setFixed(fixedValues.filter((_, i) => i !== index))} className={removeBtn} aria-label={`Quitar ${value.label || "este valor"}`} title="Quitar este valor"><Trash2 className="size-4" /></button>
          </div>
        ))}
        <button type="button" onClick={() => setFixed([...fixedValues, { key: "", label: "", value: 0 }])} className={`${addBtn} mt-0.5`}><Plus className="size-4" />Agregar valor fijo</button>
      </div>

      <FieldGroup label="Valor base" help="El número sobre el que se hace la operación.">
        <div className="grid grid-cols-2 gap-1.5">
          <Select value={base.type === "fixed" ? "fixed" : "field"} onChange={(value) => setBase(value === "fixed" ? { type: "fixed", key: "", docType: undefined, field: undefined } : { type: "field", key: undefined, docType: "", field: "" })} options={[{ value: "field", label: "Un dato del documento" }, { value: "fixed", label: "Un valor fijo" }]} />
          {base.type === "fixed"
            ? <Select value={base.key ?? ""} onChange={(value) => setBase({ key: value })} options={fixedOptions} placeholder="Elige el valor fijo" />
            : <Select value={base.docType ?? ""} onChange={(value) => setBase({ docType: value, field: "" })} options={docTypes.map((doc) => ({ value: doc.key, label: doc.name }))} placeholder="Elige el documento" />}
        </div>
        {base.type !== "fixed" && <Select value={base.field ?? ""} onChange={(value) => setBase({ field: value })} options={(fieldsByType[base.docType ?? ""] ?? []).map((field) => ({ value: field, label: fieldName(base.docType ?? "", field) }))} placeholder={base.docType ? "Elige el dato" : "Elige primero el documento"} disabled={!base.docType} />}
      </FieldGroup>

      <FieldRow label="Operación"><Select value={operation} onChange={(value) => patch({ operation: value })} options={CALC_OPERATIONS} /></FieldRow>

      <FieldGroup label={operation === "percentage" ? "Porcentaje que se aplica" : "Valor con el que se opera"} help={mode === "each_analysis_item" ? "Un número que escribes, un valor fijo o un dato de cada hallazgo." : "Un número que escribes aquí o uno de los valores fijos."}>
        <div className="grid grid-cols-2 gap-1.5">
          <Select value={operand.type === "fixed" ? "fixed" : operand.type === "item" ? "item" : "number"} onChange={(value) => setOperand(value === "fixed" ? { type: "fixed", key: "" } : value === "item" ? { type: "item", key: "" } : { type: "number", value: 0 })} options={[{ value: "number", label: "Un número" }, { value: "fixed", label: "Un valor fijo" }, ...(mode === "each_analysis_item" ? [{ value: "item", label: "Un dato del hallazgo" }] : [])]} />
          {operand.type === "fixed"
            ? <Select value={operand.key ?? ""} onChange={(value) => setOperand({ type: "fixed", key: value })} options={fixedOptions} placeholder="Elige el valor fijo" />
            : operand.type === "item"
              ? <input className={`${inp} font-mono !text-xs`} aria-label="Columna del hallazgo" value={operand.key ?? ""} onChange={(event) => setOperand({ type: "item", key: event.target.value.replace(/\s+/g, "_") })} placeholder="clave de la columna, ej. cantidad" />
              : <input className={`${inp} tabular-nums`} aria-label={operation === "percentage" ? "Porcentaje" : "Número"} type="number" step="any" value={Number.isFinite(Number(operand.value)) ? Number(operand.value) : ""} onChange={(event) => setOperand({ type: "number", value: Number(event.target.value) })} />}
        </div>
      </FieldGroup>

      <FieldRow label="Cuántas veces se calcula" help="Una sola vez por caso, o una vez por cada hallazgo de un control «Análisis con IA» que responde en tabla.">
        <Select value={mode} onChange={(value) => patch({ mode: value })} options={[{ value: "single", label: "Una vez por caso" }, { value: "each_analysis_item", label: "Una vez por cada hallazgo" }]} />
      </FieldRow>
      {mode === "each_analysis_item" && (
        <div className={`${box} flex flex-col gap-3`}>
          <FieldRow label="Análisis del que salen los hallazgos" help={analysisNodes.length ? undefined : "Este flujo aún no tiene un control «Análisis con IA»."}>
            <Select value={String(data.analysisNodeId ?? "")} onChange={(value) => patch({ analysisNodeId: value })} options={analysisNodes.map((item) => ({ value: item.id, label: item.name }))} placeholder="Elige el análisis" />
          </FieldRow>
          <FieldGroup label="Solo ciertos hallazgos (opcional)" help="Calcula únicamente los hallazgos cuya columna tenga ese valor. Vacío: todos.">
            <div className="grid grid-cols-2 gap-1.5" aria-hidden><span className={colHead}>Clave de la columna</span><span className={colHead}>Es igual a</span></div>
            <div className="grid grid-cols-2 gap-1.5">
              <input className={`${inp} font-mono !text-xs`} aria-label="Clave de la columna" value={filterDraft.key} onChange={(event) => setFilter("key", event.target.value)} placeholder="ej. tipo" />
              <input className={inp} aria-label="Es igual a" value={filterDraft.value} onChange={(event) => setFilter("value", event.target.value)} placeholder="ej. SMMLV" />
            </div>
          </FieldGroup>
        </div>
      )}

      <FieldRow label="Decimales del resultado" help="De 0 a 6. El resultado se redondea a esa cantidad.">
        <input className={`${inp} tabular-nums`} type="number" min="0" max="6" value={Number(data.decimals ?? 0)} onChange={(event) => patch({ decimals: Math.max(0, Math.min(6, Math.round(Number(event.target.value)))) })} />
      </FieldRow>

      <div className="rounded-[10px] border border-primary/20 bg-primary/[0.035] px-3 py-2.5">
        <p className="text-xs font-semibold text-primary">Así queda la fórmula</p>
        <p className="mt-1 text-[13px] font-medium text-foreground">{String(data.label || data.key || "Resultado")} = {baseField} {operatorText}</p>
        <p className={`${hlp} mt-1`}>La IA solo aporta los datos leídos; la cuenta la hace DocuIA, siempre igual, y el resultado queda disponible para el documento que se genera.</p>
      </div>
    </div>
  );
}

interface RuleRef { docType: string; field: string; label?: string }

/** Document + field of a rule, in a box with its own title; optionally the words the result uses for it. */
function RefEditor({ title, help, value, onChange, labelTitle, labelPlaceholder, docTypes, fieldsByType }: {
  title: string; help: string; value?: { docType?: string; field?: string; label?: string }; onChange: (r: RuleRef) => void;
  /** With it, the box also asks for the words the result shows for this check. */
  labelTitle?: string; labelPlaceholder?: string;
  docTypes: DocTypeOpt[]; fieldsByType: Record<string, string[]>;
}) {
  const fieldName = useFieldName();
  const v = { docType: value?.docType ?? "", field: value?.field ?? "", label: value?.label ?? "" };
  return (
    <div className={`${box} flex flex-col gap-1.5`}>
      <div><span className={lbl}>{title}</span><span className={`${hlp} mt-0.5`}>{help}</span></div>
      <div className="grid grid-cols-2 gap-1.5">
        <Select value={v.docType} onChange={(val) => onChange({ ...v, docType: val, field: "" })} options={docTypes.map((d) => ({ value: d.key, label: d.name }))} placeholder="Elige el documento" />
        <Select value={v.field} onChange={(val) => onChange({ ...v, field: val })} options={(fieldsByType[v.docType] ?? []).map((f) => ({ value: f, label: fieldName(v.docType, f) }))} placeholder={v.docType ? "Elige el dato" : "Primero el documento"} disabled={!v.docType} />
      </div>
      {labelTitle && (
        <label className="mt-1 flex flex-col gap-1">
          <span className={colHead}>{labelTitle}</span>
          <input className={inp} placeholder={labelPlaceholder} value={v.label ?? ""} onChange={(e) => onChange({ ...v, label: e.target.value })} />
        </label>
      )}
    </div>
  );
}

/** Document + field of a rule, under a plain label. */
function DocFieldPicker({ label, help, docType, field, onChange, docTypes, fieldsByType }: { label: string; help?: string; docType: string; field: string; onChange: (v: { docType: string; field: string }) => void; docTypes: DocTypeOpt[]; fieldsByType: Record<string, string[]> }) {
  const fieldName = useFieldName();
  return (
    <FieldGroup label={label} help={help}>
      <div className="grid grid-cols-2 gap-1.5">
        <Select value={docType} onChange={(v) => onChange({ docType: v, field: "" })} options={docTypes.map((d) => ({ value: d.key, label: d.name }))} placeholder="Elige el documento" />
        <Select value={field} onChange={(v) => onChange({ docType, field: v })} options={(fieldsByType[docType] ?? []).map((f) => ({ value: f, label: fieldName(docType, f) }))} placeholder={docType ? "Elige el dato" : "Primero el documento"} disabled={!docType} />
      </div>
    </FieldGroup>
  );
}

const RULE_KINDS = [
  { value: "cross_reference", label: "Aparece en otro documento" },
  { value: "field_match", label: "Dos datos coinciden" },
  { value: "clause_presence", label: "Trae (o no) una cláusula" },
  { value: "numeric_threshold", label: "Número dentro de un rango" },
  { value: "date_rule", label: "Fecha vigente o anterior a otra" },
  { value: "field_format", label: "Formato del dato / ID fiscal" },
  { value: "document_required", label: "Documentos obligatorios" },
  { value: "signatures_complete", label: "Firmas completas" },
  { value: "ai_analysis", label: "Análisis con IA" },
];
const RULE_INFO: Record<string, string> = {
  cross_reference: "Comprueba que cada elemento de una lista aparezca en otro documento. Ej.: que cada representante del contrato figure entre los apoderados de la escritura. Se puede confirmar además con un tercer documento, como un certificado de vigencia.",
  field_match: "Compara dos datos y exige que coincidan (o que sean distintos). Ej.: el monto del contrato es el mismo que el del certificado; el mismo ID fiscal en ambos.",
  clause_presence: "Exige que un documento incluya una cláusula, o que no la incluya. La cláusula es uno de los datos de la etapa de Extracción; aquí decides si debe estar o no.",
  numeric_threshold: "Exige que un número esté entre un mínimo y un máximo. Ej.: el monto no supera el tope; la garantía es al menos del 10 %.",
  date_rule: "Revisa una fecha: que no esté vencida, que sea anterior a otra, o ambas. Ej.: la póliza sigue vigente; el inicio es anterior al término.",
  field_format: "Revisa cómo está escrito un dato: ID fiscal por país (RUT, RFC, CUIT, NIT, CNPJ…), correo, fecha, número, o simplemente que no esté vacío.",
  document_required: "Exige que el caso traiga ciertos documentos y avisa cuáles faltan.",
  signatures_complete: "Comprueba que hayan firmado todas las partes que debían firmar.",
  ai_analysis: "La IA interpreta el expediente con una instrucción que tú escribes. Responde con un texto, con una tabla de hallazgos o con ambos, siempre citando el documento.",
};
const COUNTRIES = ["CL", "MX", "AR", "CO", "PE", "EC", "BR", "PY"].map((c) => ({ value: c, label: c }));
const FORMATS = [
  { value: "tax_id", label: "ID fiscal (RUT/RFC/CUIT…)" },
  { value: "email", label: "Correo" },
  { value: "date", label: "Fecha" },
  { value: "number", label: "Número" },
  { value: "nonempty", label: "No vacío (obligatorio)" },
];
const COMPARISON_NORMALIZERS = [
  { value: "auto", label: "Automático según el dato" },
  { value: "date", label: "Fecha, sin importar el formato" },
  { value: "number", label: "Monto o número" },
  { value: "identifier", label: "NIT / ID fiscal, sin importar puntos o guiones" },
  { value: "name", label: "Nombre o empresa" },
  { value: "text", label: "Texto flexible" },
];
const SEVERITIES: { value: "info" | "warn" | "block"; label: string; cls: string; effect: string }[] = [
  { value: "info",  label: "Solo informar", cls: "border-success/50 bg-success/10 text-success",                 effect: "Queda anotado en el caso; nunca lo detiene." },
  { value: "warn",  label: "Advertir",      cls: "border-warning/50 bg-warning/10 text-warning",                 effect: "El caso queda en ámbar: se puede aprobar, pero avisa." },
  { value: "block", label: "Bloquear",      cls: "border-destructive/50 bg-destructive/10 text-destructive",     effect: "El caso queda en rojo y no se puede aprobar." },
];
function defaultRule(kind: string): Record<string, unknown> {
  switch (kind) {
    case "field_match":         return { kind, left: { docType: "", field: "" }, right: { docType: "", field: "" }, mode: "equal" };
    case "clause_presence":     return { kind, docType: "", field: "", mustExist: true };
    case "numeric_threshold":   return { kind, docType: "", field: "" };
    case "date_rule":           return { kind, docType: "", field: "", notExpired: true };
    case "field_format":        return { kind, docType: "", field: "", format: "nonempty" };
    case "document_required":   return { kind, docTypes: [] };
    case "signatures_complete": return { kind, subjects: { docType: "", field: "" }, signatures: { docType: "", field: "" } };
    case "ai_analysis":         return { kind, prompt: "Analiza el expediente e identifica los hallazgos y recomendaciones que requieren revisión.", outputMode: "both", outputFields: [], sourceDocTypes: [] };
    default:                    return { kind: "cross_reference", subjects: { docType: "", field: "" }, membership: { docType: "", field: "", label: "En documento" }, statusLabels: { pass: "válido", fail: "no válido", unknown: "indeterminado" } };
  }
}

type AiTemplate = { id: string; name: string; description: string | null; config: Record<string, unknown> | null };
type OutputField = { key: string; label: string; description?: string };
const outputCols = "grid grid-cols-[minmax(0,1fr)_112px_24px] gap-1.5";

function AiAnalysisForm({ rule, setRule, docTypes }: { rule: Record<string, unknown>; setRule: (rule: Record<string, unknown>) => void; docTypes: DocTypeOpt[] }) {
  const [templates, setTemplates] = useState<AiTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [improving, setImproving] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const fields = (Array.isArray(rule.outputFields) ? rule.outputFields : []) as OutputField[];
  const selectedDocs = (Array.isArray(rule.sourceDocTypes) ? rule.sourceDocTypes : []) as string[];
  const outputMode = String(rule.outputMode ?? "free");
  const patch = (input: Record<string, unknown>) => setRule({ ...rule, ...input });
  const updateField = (index: number, change: Partial<OutputField>) => patch({ outputFields: fields.map((item, i) => (i === index ? { ...item, ...change } : item)) });
  // The rule as it is now, for answers that arrive seconds later.
  const latestRule = useRef(rule);
  useEffect(() => { latestRule.current = rule; }, [rule]);

  // Only called on mount, where templatesLoading already starts as true.
  const loadTemplates = useCallback(async () => {
    try {
      const response = await fetch("/api/v1/contracts/ai-analysis/templates");
      const payload = await response.json() as { templates?: AiTemplate[] };
      if (response.ok) setTemplates(payload.templates ?? []);
    } finally { setTemplatesLoading(false); }
  }, []);
  useEffect(() => { void loadTemplates(); }, [loadTemplates]);

  const improve = async () => {
    const prompt = String(rule.prompt ?? "").trim();
    if (prompt.length < 12) { setMessage({ ok: false, text: "Describe primero qué debe analizar la IA." }); return; }
    setImproving(true); setMessage(null);
    try {
      const response = await fetch("/api/v1/contracts/ai-analysis/improve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }) });
      const payload = await response.json() as { prompt?: string; error?: string };
      if (!response.ok || !payload.prompt) throw new Error(payload.error || "No se pudo mejorar la instrucción.");
      // Over the rule of this moment: with the one captured when the request
      // started, everything edited while the AI answered was undone.
      setRule({ ...latestRule.current, improvedPrompt: payload.prompt });
      setMessage({ ok: true, text: "Versión mejorada lista. Puedes seguir editándola." });
    } catch (error) { setMessage({ ok: false, text: error instanceof Error ? error.message : "No se pudo mejorar la instrucción." }); }
    finally { setImproving(false); }
  };

  const saveTemplate = async () => {
    const name = templateName.trim();
    const prompt = String(rule.prompt ?? "").trim();
    if (!name) { setMessage({ ok: false, text: "Ponle un nombre a la plantilla." }); return; }
    if (!prompt) { setMessage({ ok: false, text: "La plantilla necesita una instrucción." }); return; }
    setSavingTemplate(true); setMessage(null);
    try {
      const response = await fetch("/api/v1/contracts/ai-analysis/templates", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, config: { ...rule, kind: "ai_analysis" } }),
      });
      const payload = await response.json() as { template?: AiTemplate; error?: string };
      if (!response.ok || !payload.template) throw new Error(payload.error || "No se pudo guardar la plantilla.");
      setTemplates((current) => [payload.template!, ...current]); setTemplateName("");
      setMessage({ ok: true, text: "Plantilla guardada para futuros flujos." });
    } catch (error) { setMessage({ ok: false, text: error instanceof Error ? error.message : "No se pudo guardar la plantilla." }); }
    finally { setSavingTemplate(false); }
  };

  return (
    <div className="flex flex-col gap-4">
      <FieldRow label="Partir de una plantilla guardada (opcional)" help="Llena este control con un análisis que ya guardaste en otro flujo.">
        <Select value="" onChange={(id) => { const template = templates.find((item) => item.id === id); if (template?.config) { setRule({ ...template.config, kind: "ai_analysis" }); setMessage({ ok: true, text: `Plantilla “${template.name}” aplicada al flujo.` }); } }} options={templates.filter((item) => item.config).map((item) => ({ value: item.id, label: item.name }))} placeholder={templatesLoading ? "Cargando plantillas…" : "Elige una plantilla"} disabled={templatesLoading} />
      </FieldRow>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-end justify-between gap-2">
          <label htmlFor="ai-prompt"><span className={lbl}>Instrucción para la IA</span><span className={`${hlp} mt-0.5`}>Qué debe revisar y qué debe responder. Si falta evidencia en los documentos, lo dice en vez de inventar.</span></label>
          <button type="button" onClick={() => void improve()} disabled={improving} className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-primary/25 bg-card px-2 py-1 text-xs font-medium text-primary hover:bg-primary/5 disabled:opacity-50">{improving ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />} Mejorar con IA</button>
        </div>
        <textarea id="ai-prompt" rows={5} className={`${inp} resize-y leading-relaxed`} value={String(rule.prompt ?? "")} onChange={(event) => patch({ prompt: event.target.value })} placeholder="Ej. Identifica las pólizas exigidas por el contrato y recomienda coberturas basadas solo en sus obligaciones." />
      </div>

      {typeof rule.improvedPrompt === "string" && rule.improvedPrompt.trim() && (
        <div className="flex flex-col gap-1.5 rounded-[10px] border border-success/25 bg-success/5 p-3">
          <div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold text-success">Versión mejorada</span><button type="button" onClick={() => patch({ prompt: rule.improvedPrompt, improvedPrompt: undefined })} className="text-xs font-semibold text-link hover:underline">Usar esta versión</button></div>
          <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground/80">{rule.improvedPrompt}</p>
        </div>
      )}

      <FieldRow label="Criterios de tu empresa (opcional)" help="Reglas propias que la IA debe respetar al analizar.">
        <textarea rows={4} className={`${inp} resize-y leading-relaxed`} value={String(rule.internalRules ?? "")} onChange={(event) => patch({ internalRules: event.target.value })} placeholder="Ej. Para obra civil, revisar cumplimiento y responsabilidad civil. Nunca proponer una cobertura sin respaldo contractual o regla interna." />
      </FieldRow>

      <FieldGroup label="Documentos que debe leer" help="Sin marcar ninguno, lee todo el expediente.">
        {docTypes.map((doc) => {
          const selected = selectedDocs.includes(doc.key);
          return <label key={doc.key} className="flex items-start gap-2 text-[13px]"><input type="checkbox" className={check} checked={selected} onChange={(event) => patch({ sourceDocTypes: event.target.checked ? [...selectedDocs, doc.key] : selectedDocs.filter((key) => key !== doc.key) })} />{doc.name}</label>;
        })}
      </FieldGroup>

      <FieldRow label="Cómo responde" help="Con un texto, con una tabla de hallazgos cuyas columnas defines tú, o con ambos.">
        <Select value={outputMode} onChange={(value) => patch({ outputMode: value })} options={[
          { value: "free", label: "Un texto" },
          { value: "structured", label: "Una tabla de hallazgos" },
          { value: "both", label: "Texto y tabla" },
        ]} />
      </FieldRow>

      {outputMode !== "free" && (
        <div className={`${box} flex flex-col gap-1.5`}>
          <div><span className={lbl}>Columnas de la tabla</span><span className={`${hlp} mt-0.5`}>Lo que la IA anota de cada hallazgo. Se ve en el caso y se puede llevar al documento que se genera.</span></div>
          {fields.length > 0 && <div className={`${outputCols} mt-1`} aria-hidden><span className={colHead}>Nombre de la columna</span><span className={colHead}>Clave interna</span><span /></div>}
          {fields.map((field, index) => (
            <div key={index} className={outputCols}>
              <input className={inp} aria-label="Nombre de la columna" placeholder="Ej. Cobertura" value={field.label} onChange={(event) => updateField(index, { label: event.target.value })}
                onBlur={() => { if (!field.key.trim() && field.label.trim()) updateField(index, { key: keyFrom(field.label) }); }} />
              <input className={`${inp} font-mono !text-xs`} aria-label="Clave interna" placeholder="se llena sola" value={field.key} onChange={(event) => updateField(index, { key: event.target.value })} />
              <button type="button" onClick={() => patch({ outputFields: fields.filter((_, i) => i !== index) })} className={removeBtn} aria-label={`Quitar ${field.label || "esta columna"}`} title="Quitar esta columna"><Trash2 className="size-4" /></button>
            </div>
          ))}
          <button type="button" onClick={() => patch({ outputFields: [...fields, { key: "", label: "" }] })} className={`${addBtn} mt-0.5`}><Plus className="size-4" />Agregar columna</button>
        </div>
      )}

      <div className="flex flex-col gap-1.5 border-t border-line-soft pt-4">
        <label htmlFor="ai-template-name"><span className={`${lbl} flex items-center gap-1.5`}><BookMarked className="size-4 text-primary" />Guardar como plantilla</span><span className={`${hlp} mt-0.5`}>Para reusar este análisis en otros flujos.</span></label>
        <div className="flex gap-1.5"><input id="ai-template-name" className={inp} value={templateName} onChange={(event) => setTemplateName(event.target.value)} placeholder="Nombre, ej. Requisitos de aseguramiento" /><button type="button" onClick={() => void saveTemplate()} disabled={savingTemplate} className="shrink-0 rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">{savingTemplate ? "Guardando…" : "Guardar"}</button></div>
      </div>
      {message && <p role="status" className={`text-[13px] leading-relaxed ${message.ok ? "text-tone-ok" : "text-tone-err"}`}>{message.text}</p>}
    </div>
  );
}

function ValidateForm({ data, patch, docTypes, fieldsByType }: { data: AnyData; patch: (p: AnyData) => void; docTypes: DocTypeOpt[]; fieldsByType: Record<string, string[]> }) {
  const rule = (data.rule ?? defaultRule("cross_reference")) as { kind: string } & Record<string, unknown>;
  const kind = String(rule.kind ?? "cross_reference");
  const severity = String(data.severity ?? "warn");
  const setRule = (r: Record<string, unknown>) => patch({ rule: { ...rule, ...r } });
  const ref = (k: string) => (rule[k] as { docType?: string; field?: string; label?: string } | undefined) ?? {};
  const numStr = (v: unknown) => (v === undefined || v === null ? "" : String(v));
  const pickers = { docTypes, fieldsByType };

  return (
    <div className="flex flex-col gap-4">
      <FieldRow label="Nombre del control" help="Así aparece en el resultado del caso.">
        <input className={inp} value={String(data.name ?? "")} onChange={(e) => patch({ name: e.target.value })} placeholder="Ej. Firmantes con poder vigente" />
      </FieldRow>

      {kind !== "ai_analysis" && (
        <RuleFromText docTypes={docTypes} fieldsByType={fieldsByType}
          current={{ name: String(data.name ?? ""), severity, rule }}
          onApply={(next) => patch({ name: next.name, severity: next.severity, rule: next.rule })} />
      )}

      <FieldRow label="Qué revisa" help={RULE_INFO[kind]}>
        <Select value={kind} onChange={(k) => patch({ rule: defaultRule(k) })} options={RULE_KINDS} />
      </FieldRow>

      <FieldGroup label="Si no se cumple" help="Cuando el control se cumple, queda en verde. Elige qué pasa cuando no:">
        <div className="grid grid-cols-3 gap-1.5">
          {SEVERITIES.map((s) => (
            <button key={s.value} type="button" aria-pressed={severity === s.value} onClick={() => patch({ severity: s.value })}
              className={`min-h-9 rounded-lg border px-2 text-[12.5px] font-medium transition-colors ${severity === s.value ? s.cls : "border-border text-muted-foreground hover:bg-secondary"}`}>{s.label}</button>
          ))}
        </div>
        <p className={hlp}>{SEVERITIES.find((s) => s.value === severity)?.effect}</p>
      </FieldGroup>

      {kind === "ai_analysis" && <AiAnalysisForm rule={rule} setRule={(updated) => patch({ rule: updated })} docTypes={docTypes} />}

      {kind === "cross_reference" && (() => {
        const sl = (rule.statusLabels as { pass: string; fail: string; unknown: string }) ?? { pass: "válido", fail: "no válido", unknown: "indeterminado" };
        const hasConf = !!rule.confirmation;
        return (
          <>
            <RefEditor title="A quién se revisa" help="La lista que se comprueba, uno por uno. Ej.: los representantes del contrato." value={ref("subjects")} onChange={(r) => setRule({ subjects: r })} {...pickers} />
            <RefEditor title="Dónde deben aparecer" help="El dato de otro documento donde tiene que estar cada uno. Ej.: los apoderados de la escritura." value={ref("membership")} onChange={(r) => setRule({ membership: r })} labelTitle="Cómo se llama esta comprobación en el resultado" labelPlaceholder="Ej. En escritura de poderes" {...pickers} />
            <label className="flex items-start gap-2 text-[13px]">
              <input type="checkbox" className={check} checked={hasConf} onChange={(e) => setRule({ confirmation: e.target.checked ? { docType: "", field: "", label: "Confirmación" } : undefined })} />
              <span><span className="font-semibold">Confirmar además con otro documento</span><span className={hlp}>Para comprobar que lo anterior sigue vigente y no fue revocado.</span></span>
            </label>
            {hasConf && <RefEditor title="Documento que lo confirma" help="El dato que dice si sigue vigente o fue revocado. Ej.: el estado en el certificado de vigencia." value={ref("confirmation")} onChange={(r) => setRule({ confirmation: r })} labelTitle="Cómo se llama esta comprobación en el resultado" labelPlaceholder="Ej. Certificado de vigencia" {...pickers} />}
            <FieldGroup label="Palabra que se muestra en el resultado" help="Una por cada desenlace, junto al nombre de quien se revisó.">
              <div className="grid grid-cols-3 gap-1.5" aria-hidden><span className={colHead}>Si aparece</span><span className={colHead}>Si no aparece</span><span className={colHead}>Si no se sabe</span></div>
              <div className="grid grid-cols-3 gap-1.5">
                <input className={inp} aria-label="Palabra si aparece" value={sl.pass} onChange={(e) => setRule({ statusLabels: { ...sl, pass: e.target.value } })} />
                <input className={inp} aria-label="Palabra si no aparece" value={sl.fail} onChange={(e) => setRule({ statusLabels: { ...sl, fail: e.target.value } })} />
                <input className={inp} aria-label="Palabra si no se sabe" value={sl.unknown} onChange={(e) => setRule({ statusLabels: { ...sl, unknown: e.target.value } })} />
              </div>
            </FieldGroup>
          </>
        );
      })()}

      {kind === "field_match" && (
        <>
          <DocFieldPicker label="Primer dato" docType={ref("left").docType ?? ""} field={ref("left").field ?? ""} onChange={(v) => setRule({ left: v })} {...pickers} />
          <DocFieldPicker label="Segundo dato" docType={ref("right").docType ?? ""} field={ref("right").field ?? ""} onChange={(v) => setRule({ right: v })} {...pickers} />
          <FieldRow label="Qué se exige"><Select value={String(rule.mode ?? "equal")} onChange={(v) => setRule({ mode: v })} options={[{ value: "equal", label: "Que coincidan" }, { value: "different", label: "Que sean distintos" }]} /></FieldRow>
          <FieldRow label="Cómo se comparan" help="Fechas, importes y nombres se igualan antes de comparar (por ejemplo, 01/02/2026 y 1 de febrero de 2026). Cambia «Automático» solo si quieres fijar el criterio.">
            <Select value={String(rule.normalizer ?? "auto")} onChange={(v) => setRule({ normalizer: v === "auto" ? undefined : v })} options={COMPARISON_NORMALIZERS} />
          </FieldRow>
          <FieldRow label="Diferencia aceptada (opcional)" help="Solo para números: cuánto pueden diferir y seguir contando como iguales. Vacío: deben ser iguales.">
            <input type="number" className={`${inp} tabular-nums`} value={numStr(rule.numericTolerance)} onChange={(e) => setRule({ numericTolerance: e.target.value === "" ? undefined : Number(e.target.value) })} placeholder="0" />
          </FieldRow>
        </>
      )}

      {kind === "clause_presence" && (
        <>
          <DocFieldPicker label="Dónde está la cláusula" help="El dato de Extracción que la captura; la IA la detecta por su significado." docType={String(rule.docType ?? "")} field={String(rule.field ?? "")} onChange={(v) => setRule(v)} {...pickers} />
          <FieldRow label="Qué se exige"><Select value={rule.mustExist === false ? "no" : "si"} onChange={(v) => setRule({ mustExist: v === "si" })} options={[{ value: "si", label: "Que el documento la incluya" }, { value: "no", label: "Que el documento no la incluya" }]} /></FieldRow>
        </>
      )}

      {kind === "numeric_threshold" && (
        <>
          <DocFieldPicker label="Número que se revisa" docType={String(rule.docType ?? "")} field={String(rule.field ?? "")} onChange={(v) => setRule(v)} {...pickers} />
          <div className="flex flex-col gap-1.5">
            <div className="grid grid-cols-2 gap-1.5">
              <FieldRow label="Mínimo"><input type="number" className={`${inp} tabular-nums`} value={numStr(rule.min)} onChange={(e) => setRule({ min: e.target.value === "" ? undefined : Number(e.target.value) })} /></FieldRow>
              <FieldRow label="Máximo"><input type="number" className={`${inp} tabular-nums`} value={numStr(rule.max)} onChange={(e) => setRule({ max: e.target.value === "" ? undefined : Number(e.target.value) })} /></FieldRow>
            </div>
            <p className={hlp}>Deja vacío el que no aplique.</p>
          </div>
        </>
      )}

      {kind === "date_rule" && (
        <>
          <DocFieldPicker label="Fecha que se revisa" docType={String(rule.docType ?? "")} field={String(rule.field ?? "")} onChange={(v) => setRule(v)} {...pickers} />
          <label className="flex items-start gap-2 text-[13px]"><input type="checkbox" className={check} checked={rule.notExpired !== false} onChange={(e) => setRule({ notExpired: e.target.checked })} /><span><span className="font-semibold">No debe estar vencida</span><span className={hlp}>Falla si la fecha ya pasó el día en que se analiza el caso.</span></span></label>
          <label className="flex items-start gap-2 text-[13px]"><input type="checkbox" className={check} checked={!!rule.before} onChange={(e) => setRule({ before: e.target.checked ? { docType: "", field: "" } : undefined })} /><span className="font-semibold">Debe ser anterior a otra fecha</span></label>
          {rule.before != null && <DocFieldPicker label="La otra fecha" help="La que debe ser posterior. Ej.: la fecha de término." docType={ref("before").docType ?? ""} field={ref("before").field ?? ""} onChange={(v) => setRule({ before: v })} {...pickers} />}
        </>
      )}

      {kind === "field_format" && (
        <>
          <DocFieldPicker label="Dato que se revisa" docType={String(rule.docType ?? "")} field={String(rule.field ?? "")} onChange={(v) => setRule(v)} {...pickers} />
          <FieldRow label="Formato esperado"><Select value={String(rule.format ?? "nonempty")} onChange={(v) => setRule({ format: v })} options={FORMATS} /></FieldRow>
          {rule.format === "tax_id" && <FieldRow label="País del ID fiscal" help="Sin país, solo se revisa que parezca un identificador."><Select value={String(rule.country ?? "")} onChange={(v) => setRule({ country: v || undefined })} options={COUNTRIES} placeholder="Cualquier país" /></FieldRow>}
        </>
      )}

      {kind === "document_required" && (
        <FieldGroup label="Documentos que el caso debe traer" help={docTypes.length === 0 ? "Agrega primero etapas «Documento esperado»." : undefined}>
          {docTypes.map((d) => {
            const list = (rule.docTypes as string[]) ?? [];
            const on = list.includes(d.key);
            return <label key={d.key} className="flex items-start gap-2 text-[13px]"><input type="checkbox" className={check} checked={on} onChange={(e) => setRule({ docTypes: e.target.checked ? [...list, d.key] : list.filter((x) => x !== d.key) })} />{d.name}</label>;
          })}
        </FieldGroup>
      )}

      {kind === "signatures_complete" && (
        <>
          <DocFieldPicker label="Quiénes deben firmar" help="La lista de partes. Ej.: los representantes del contrato." docType={ref("subjects").docType ?? ""} field={ref("subjects").field ?? ""} onChange={(v) => setRule({ subjects: v })} {...pickers} />
          <DocFieldPicker label="Quiénes firmaron" help="El dato con las firmas que trae el documento." docType={ref("signatures").docType ?? ""} field={ref("signatures").field ?? ""} onChange={(v) => setRule({ signatures: v })} {...pickers} />
        </>
      )}
    </div>
  );
}

function GenerateForm({ data, patch, onOpenEditor, onOpenWordTemplate }: { data: AnyData; patch: (p: AnyData) => void; onOpenEditor: () => void; onOpenWordTemplate: () => void }) {
  const hasContent = !!(data.html || data.body);
  const source = data.source === "word" ? "word" : "editor";
  const openBtn = "flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-medium text-primary-foreground shadow-[0_1px_3px_oklch(0.48_0.15_182_/_0.3)] transition-colors hover:bg-primary/90";
  return (
    <div className="flex flex-col gap-4">
      <FieldRow label="Nombre del documento" help="El nombre con el que se genera y aparece en el caso.">
        <input className={inp} value={String(data.name ?? "")} onChange={(e) => patch({ name: e.target.value })} placeholder="Ej. Cotización" />
      </FieldRow>
      <FieldGroup label="Cómo se arma" help="Diseñado aquí y exportado a PDF, o sobre tu propia plantilla de Word.">
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-secondary/60 p-1">
          <button type="button" aria-pressed={source === "editor"} onClick={() => patch({ source: "editor" })} className={`rounded-md px-2 py-2 text-[13px] font-medium transition-colors ${source === "editor" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}><PanelLeft className="mr-1 inline size-4" /> Editor</button>
          <button type="button" aria-pressed={source === "word"} onClick={() => { patch({ source: "word" }); onOpenWordTemplate(); }} className={`rounded-md px-2 py-2 text-[13px] font-medium transition-colors ${source === "word" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}><FileUp className="mr-1 inline size-4" /> Plantilla Word</button>
        </div>
      </FieldGroup>
      {source === "editor" ? (
        <>
          <button type="button" onClick={onOpenEditor} className={openBtn}><FileText className="size-4" /> Abrir editor del documento</button>
          <p className={hlp}>Diseña el documento desde cero: títulos, tablas, logo y datos del caso. Se exporta a PDF. {hasContent ? "Ya tiene contenido guardado." : "Aún sin contenido."}</p>
        </>
      ) : (
        <>
          <button type="button" onClick={onOpenWordTemplate} className={openBtn}><FileUp className="size-4" /> {data.wordTemplate ? "Abrir plantilla y mapeo" : "Cargar plantilla Word"}</button>
          <p className={hlp}>Sube el Word de tu empresa y marca en él qué texto corresponde a cada dato. El resultado conserva su diseño y queda como Word editable.</p>
        </>
      )}
      <p className={hlp}>También puedes hacer <strong className="font-semibold text-foreground">doble clic</strong> en la etapa, en el lienzo, para abrirlo.</p>
    </div>
  );
}

// Custom dropdown (native <select> option lists can't be themed). Fully styled trigger + popover.
function Select({ value, onChange, options, placeholder, disabled }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; placeholder?: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as globalThis.Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const sel = options.find((o) => o.value === value);
  return (
    <div className="relative" ref={ref}>
      <button type="button" disabled={disabled} onClick={() => setOpen((o) => !o)}
        className={`${inp} flex items-center justify-between gap-1 text-left disabled:opacity-50 ${open ? "border-primary ring-2 ring-primary/15" : ""}`}>
        <span className={`truncate ${sel ? "text-foreground" : "text-muted-foreground"}`}>{sel ? sel.label : (placeholder ?? "—")}</span>
        <ChevronDown className={`size-3.5 text-muted-foreground shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && !disabled && (
        <div className="absolute z-50 mt-1 w-full max-h-52 overflow-y-auto rounded-md border border-border bg-popover py-1 shadow-[0_8px_32px_oklch(0.18_0.015_258_/_0.12)]">
          {options.length === 0 && <p className="px-2.5 py-1.5 text-xs text-muted-foreground">Sin opciones</p>}
          {options.map((o) => (
            <button key={o.value} type="button" onClick={() => { onChange(o.value); setOpen(false); }}
              className={`w-full text-left px-2.5 py-1.5 text-[13px] transition-colors hover:bg-secondary ${o.value === value ? "bg-primary/5 text-primary font-medium" : "text-foreground"}`}>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Builder (edits ONE flow, identified by flowId) ────────────────────
/** Where the first schema problem is, so "El flujo no es válido" says what to fix. */
function firstIssue(issues: unknown, graph: { nodes: Array<{ kind?: string; data?: unknown }> }): string {
  const issue = Array.isArray(issues) ? issues[0] as { path?: Array<string | number>; message?: string } | undefined : undefined;
  if (!issue) return "";
  const path = issue.path ?? [];
  const node = path[0] === "nodes" && typeof path[1] === "number" ? graph.nodes[path[1]] : undefined;
  const name = (node?.data as { name?: unknown } | undefined)?.name;
  const where = node ? `etapa «${typeof name === "string" && name ? name : node.kind ?? path[1]}»` : "";
  const field = path.slice(node ? 3 : 0).join(" › ");
  return ` ${[where, field].filter(Boolean).join(", ")}${issue.message ? `: ${issue.message}` : ""}`;
}

function FlowBuilder({ flowId }: { flowId: string }) {
  const rf = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [name, setName] = useState("Flujo de contratos");
  // Version loaded from the server; saving sends it back so a concurrent edit
  // by another admin is reported instead of silently overwritten.
  const versionRef = useRef<number | null>(null);
  // When the draft was last saved, as the server told it: saving a draft does
  // not move the version, so this is what detects another person's save.
  const draftAtRef = useRef<string | null | undefined>(undefined);
  const [version, setVersion] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [docEditorOpen, setDocEditorOpen] = useState(false);
  const [wordTemplateOpen, setWordTemplateOpen] = useState(false);
  const [visualTraining, setVisualTraining] = useState<{ documentType: string; documentName: string; fields: TrainingField[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Versiones de flujo: guardar deja un borrador; publicar crea la versión siguiente.
  const [versioned, setVersioned] = useState(false);
  const [published, setPublished] = useState<FlowGraph | null>(null);
  const [hasDraft, setHasDraft] = useState(false);
  const [history, setHistory] = useState<FlowVersionRow[]>([]);
  const [panel, setPanel] = useState<null | "publish" | "test" | "history">(null);
  const [publishChanges, setPublishChanges] = useState<string[]>([]);
  const [test, setTest] = useState<{ loading: boolean; error: string | null; cases: FlowTestRow[] }>({ loading: false, error: null, cases: [] });

  const nodeTypes = useMemo(() => ({ intake: NodeCard, extract: NodeCard, calculate: NodeCard, validate: NodeCard, reference_lookup: NodeCard, generate: NodeCard, approval: NodeCard, note: NodeCard }), []);

  const setGraph = useCallback((graph: { nodes?: Array<{ id: string; kind: Kind; position: { x: number; y: number }; data: AnyData; width?: number; height?: number }>; edges?: Array<{ id: string; source: string; target: string }> }) => {
    setNodes((graph.nodes ?? []).map((n) => ({ id: n.id, type: n.kind, position: n.position, data: n.data, width: n.width, height: n.height })));
    setEdges((graph.edges ?? []).map((e) => ({ id: e.id, source: e.source, target: e.target })));
  }, [setNodes, setEdges]);

  const fetchFlow = useCallback(() => fetch(`/api/v1/contracts/flow/${flowId}`).then((r) => r.json()), [flowId]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const applyFlow = useCallback((d: any, applyGraph: boolean) => {
    if (!d?.flow) return;
    versionRef.current = d.flow.version ?? null; setVersion(d.flow.version ?? null);
    const v = d.versions ?? { enabled: false };
    draftAtRef.current = v.enabled ? v.draftUpdatedAt ?? null : undefined;
    setVersioned(Boolean(v.enabled));
    setPublished(d.flow.graph ?? null);
    setHasDraft(Boolean(v.pending));
    setHistory(Array.isArray(v.history) ? v.history : []);
    if (applyGraph) { setName(d.flow.name ?? "Flujo"); setGraph(v.draft ?? d.flow.graph ?? { nodes: [], edges: [] }); }
  }, [setGraph]);

  useEffect(() => {
    // Without the stored flow there is nothing to edit: showing an empty
    // canvas here would let "Guardar" overwrite the real flow with it.
    fetchFlow()
      .then((d) => {
        if (!d?.flow) throw new Error(typeof d?.error === "string" ? d.error : "");
        // A stored flow that no longer passes the schema comes back as an empty
        // graph: opening it would let "Guardar" replace the real one with nothing.
        if (d.flow.valid === false) throw new Error("Este flujo se guardó con un formato anterior y no se puede abrir en el editor. Tu flujo sigue intacto; avísale a DocuIA para actualizarlo.");
        applyFlow(d, true);
      })
      .catch((e: unknown) => setLoadError((e instanceof Error && e.message) || "No se pudo cargar el flujo."))
      .finally(() => setLoading(false));
  }, [fetchFlow, applyFlow]);

  const onConnect = useCallback((c: Connection) =>
    setEdges((eds) => addEdge({ ...c, id: `e_${c.source}_${c.target}_${crypto.randomUUID().slice(0, 6)}` }, eds)), [setEdges]);

  const addNode = (kind: Kind, at?: { x: number; y: number }) => {
    const id = `${kind}_${crypto.randomUUID().slice(0, 8)}`;
    setNodes((ns) => [...ns, {
      id, type: kind, position: at ?? { x: 80 + (ns.length % 4) * 70, y: 70 + ns.length * 28 }, data: defaultData(kind),
      ...(kind === "note" ? { width: 280, height: 160 } : {}),
    }]);
    setSelectedId(id);
  };

  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const kind = e.dataTransfer.getData("application/flowkind") as Kind;
    if (!kind || !KIND_META[kind]) return;
    addNode(kind, rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
  };

  const patchSelected = (patch: AnyData) =>
    setNodes((ns) => ns.map((n) => n.id === selectedId ? { ...n, data: { ...n.data, ...patch } } : n));

  const patchNote = useCallback((id: string, body: string) =>
    setNodes((ns) => ns.map((n) => n.id === id ? { ...n, data: { ...n.data, body } } : n)), [setNodes]);

  const deleteSelected = () => {
    if (!selectedId) return;
    setNodes((ns) => ns.filter((n) => n.id !== selectedId));
    setEdges((es) => es.filter((e) => e.source !== selectedId && e.target !== selectedId));
    setSelectedId(null);
  };

  // Reorder an intake document by swapping its vertical position with a neighbor.
  const moveIntake = (id: string, dir: -1 | 1) => {
    setNodes((ns) => {
      const intakes = ns.filter((n) => n.type === "intake").sort((a, b) => a.position.y - b.position.y);
      const idx = intakes.findIndex((n) => n.id === id);
      const swap = intakes[idx + dir];
      if (!swap) return ns;
      const cur = intakes[idx];
      const yCur = cur.position.y, ySwap = swap.position.y;
      return ns.map((n) =>
        n.id === cur.id  ? { ...n, position: { ...n.position, y: ySwap } } :
        n.id === swap.id ? { ...n, position: { ...n.position, y: yCur } } : n);
    });
  };

  function currentGraph() {
    return {
      nodes: nodes.map((n) => ({
        id: n.id, kind: n.type, position: { x: Math.round(n.position.x), y: Math.round(n.position.y) }, data: n.data,
        ...(n.type === "note" && typeof n.width === "number" && typeof n.height === "number"
          ? { width: Math.round(n.width), height: Math.round(n.height) }
          : {}),
      })),
      edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
    } as FlowGraph;
  }

  async function save(): Promise<boolean> {
    setSaving(true); setMsg(null);
    const graph = currentGraph();
    try {
      const res = await fetch(`/api/v1/contracts/flow/${flowId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, graph, version: versionRef.current, ...(draftAtRef.current !== undefined ? { draftAt: draftAtRef.current } : {}) }) });
      const d = await res.json();
      if (res.ok && typeof d.version === "number") { versionRef.current = d.version; setVersion(d.version); }
      if (res.ok && d.draft) draftAtRef.current = typeof d.draftAt === "string" ? d.draftAt : null;
      if (res.ok && d.draft) setHasDraft(Boolean(d.pending));
      setMsg(res.ok ? { ok: true, text: d.draft ? (d.pending ? "Borrador guardado" : "Guardado · nada nuevo por publicar") : `Guardado (v${d.version ?? 1})` } : { ok: false, text: `${d.error ?? "Error al guardar"}${firstIssue(d.issues, graph)}` });
      return res.ok;
    } catch { setMsg({ ok: false, text: "Sin conexión" }); return false; }
    finally { setSaving(false); }
  }

  async function openPublish() {
    if (!await save()) return;
    setPublishChanges(diffFlows(published, currentGraph()));
    setPanel("publish");
  }

  async function publish({ note, reanalyze }: { note: string; reanalyze: boolean }): Promise<string | null> {
    try {
      const res = await fetch(`/api/v1/contracts/flow/${flowId}/publish`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note, reanalyze, version: versionRef.current }) });
      const d = await res.json();
      if (!res.ok) return d.error ?? "No se pudo publicar";
      applyFlow(await fetchFlow(), false);
      setPanel(null);
      setMsg({ ok: true, text: d.reanalyzed ? `Publicada la versión ${d.version} · ${d.reanalyzed} caso${d.reanalyzed === 1 ? "" : "s"} en análisis` : `Publicada la versión ${d.version}` });
      return null;
    } catch { return "Sin conexión"; }
  }

  async function runTest() {
    if (!await save()) return;
    setPanel("test");
    setTest({ loading: true, error: null, cases: [] });
    try {
      const res = await fetch(`/api/v1/contracts/flow/${flowId}/test`, { method: "POST" });
      const d = await res.json();
      setTest(res.ok ? { loading: false, error: null, cases: d.cases ?? [] } : { loading: false, error: d.error ?? "No se pudo probar", cases: [] });
    } catch { setTest({ loading: false, error: "Sin conexión", cases: [] }); }
  }

  const selected = nodes.find((n) => n.id === selectedId) ?? null;

  const docTypeOpts: DocTypeOpt[] = nodes.filter((n) => n.type === "intake")
    .map((n) => ({ key: String((n.data as AnyData).docTypeKey ?? ""), name: String((n.data as AnyData).name || (n.data as AnyData).docTypeKey || "") }))
    .filter((d) => d.key);
  const fieldsByType: Record<string, string[]> = {};
  // What each key is called, so the pickers show "Número del contrato" and not "numero_contrato".
  const fieldNames: FieldNames = {};
  for (const n of nodes.filter((n) => n.type === "extract")) {
    const k = String((n.data as AnyData).docTypeKey ?? "");
    if (!k) continue;
    const fs = (Array.isArray((n.data as AnyData).fields) ? (n.data as AnyData).fields as FieldT[] : []).filter((f) => f.fieldKey);
    (fieldsByType[k] ??= []).push(...fs.map((f) => f.fieldKey));
    for (const f of fs) (fieldNames[k] ??= {})[f.fieldKey] = f.label;
  }
  const analysisNodes: AnalysisNodeOption[] = nodes
    .filter((node) => node.type === "validate" && (node.data as AnyData).rule && typeof (node.data as AnyData).rule === "object" && ((node.data as AnyData).rule as { kind?: unknown }).kind === "ai_analysis")
    .map((node) => ({ id: node.id, name: String((node.data as AnyData).name || "Análisis con IA") }));
  // The template still stores the stable key ({{field_key}}), but the editor
  // presents the human label that the tenant configured for that field.
  const editorFields = new Map<string, { key: string; label: string }>();
  for (const n of nodes.filter((node) => node.type === "extract")) {
    const docTypeKey = String((n.data as AnyData).docTypeKey ?? "");
    const documentName = docTypeOpts.find((doc) => doc.key === docTypeKey)?.name;
    for (const field of (Array.isArray((n.data as AnyData).fields) ? (n.data as AnyData).fields as FieldT[] : [])) {
      if (!field.fieldKey) continue;
      const fieldName = field.label?.trim() || field.fieldKey;
      editorFields.set(field.fieldKey, { key: field.fieldKey, label: documentName ? `${documentName} · ${fieldName}` : fieldName });
    }
  }
  for (const n of nodes.filter((node) => node.type === "calculate")) {
    const data = n.data as AnyData;
    const key = String(data.key ?? "").trim();
    if (key) editorFields.set(key, { key, label: String(data.label ?? data.name ?? key) });
  }
  editorFields.set("_validations", { key: "_validations", label: "Resultados de validación" });
  editorFields.set("_ai_analysis", { key: "_ai_analysis", label: "Análisis con IA" });
  editorFields.set("_ai_findings", { key: "_ai_findings", label: "Hallazgos estructurados de IA" });

  // Number the intake documents top-to-bottom so "which comes first" is visible.
  const intakeOrder = new Map(
    nodes.filter((n) => n.type === "intake").sort((a, b) => a.position.y - b.position.y).map((n, i) => [n.id, i + 1]),
  );
  const displayNodes = nodes.map((n) => {
    if (n.type === "intake") return { ...n, data: { ...n.data, _order: intakeOrder.get(n.id) } };
    if (n.type === "note") return { ...n, data: { ...n.data, _onNoteChange: (body: string) => patchNote(n.id, body) } };
    return n;
  });

  if (loading) return <div className="flex-1 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  if (loadError) return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <p role="alert" className="text-sm text-tone-err">{loadError}</p>
      <span className="flex gap-2">
        <Link href="/contracts/flow" className={btn("secondary")}>Volver a Flujos</Link>
        <button type="button" onClick={() => window.location.reload()} className={btn("primary")}>Reintentar</button>
      </span>
    </div>
  );

  const stageCount = nodes.filter((n) => n.type !== "note").length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border bg-card px-5 py-3">
        <Link href="/contracts/flow" className="inline-flex items-center gap-1.5 text-[13px] text-link hover:underline"><ArrowLeft className="size-4" />Flujos</Link>
        <span aria-hidden className="h-6 w-px bg-border" />
        <label className="min-w-0">
          <span className="sr-only">Nombre del flujo</span>
          <input value={name} onChange={(e) => setName(e.target.value)}
            className="min-w-[220px] rounded-md border border-transparent bg-transparent px-1.5 py-1 text-[17px] font-semibold tracking-[-0.01em] outline-none hover:border-border focus:border-primary" />
        </label>
        {version !== null && <StatusPill tone="mute">v{version}</StatusPill>}
        {versioned && hasDraft && <StatusPill tone="warn">Borrador sin publicar</StatusPill>}
        <span className="text-[12.5px] text-muted-foreground">{stageCount} etapa{stageCount === 1 ? "" : "s"}</span>
        <span className="flex-1" />
        {msg && <span role="status" className={`text-[13px] ${msg.ok ? "text-tone-ok" : "text-tone-err"}`}>{msg.text}</span>}
        {versioned ? (
          <>
            <button type="button" onClick={() => setPanel("history")} className={btn("text")}>Versiones</button>
            <button type="button" onClick={() => void runTest()} disabled={saving} className={btn("secondary")}>Probar con casos anteriores</button>
            <button type="button" onClick={() => void save()} disabled={saving} className={btn("secondary")}>
              {saving ? <Loader2 className="animate-spin" /> : <Save />} Guardar borrador
            </button>
            <button type="button" onClick={() => void openPublish()} disabled={saving} className={btn("primary")}>Publicar v{(version ?? 0) + 1}</button>
          </>
        ) : (
          <button type="button" onClick={() => void save()} disabled={saving} className={btn("primary")}>
            {saving ? <Loader2 className="animate-spin" /> : <Save />} Guardar flujo
          </button>
        )}
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[216px_minmax(0,1fr)_440px]">
        <aside aria-label="Etapas disponibles" className="flex min-h-0 flex-col gap-1.5 overflow-y-auto border-r border-border bg-card p-3">
          <h2 className="px-1.5 pb-1 pt-1 text-xs font-semibold uppercase tracking-[0.06em] text-foreground/75">Agregar etapa</h2>
          {(Object.keys(KIND_META) as Kind[]).map((k) => {
            const M = KIND_META[k];
            return (
              <button key={k} type="button" onClick={() => addNode(k)} draggable
                onDragStart={(e) => { e.dataTransfer.setData("application/flowkind", k); e.dataTransfer.effectAllowed = "copy"; }}
                className="flex w-full cursor-grab items-start gap-2.5 rounded-lg border border-transparent p-2 text-left transition-colors hover:border-border hover:bg-background active:cursor-grabbing">
                <span className="mt-px flex size-7 shrink-0 items-center justify-center rounded-md bg-tone-info-bg text-tone-info"><M.Icon className="size-4" /></span>
                <span className="min-w-0"><b className="block text-[13px] font-semibold leading-snug">{M.title}</b><span className="block text-xs leading-snug text-muted-foreground">{M.hint}</span></span>
              </button>
            );
          })}
          <p className="mt-auto border-t border-line-soft px-1.5 pt-3 text-xs leading-relaxed text-muted-foreground">Arrastra una etapa al lienzo o tócala para agregarla. Conecta del punto derecho de una al izquierdo de la siguiente.</p>
        </aside>

        <div className="relative min-h-[480px] bg-background" onDrop={onDrop} onDragOver={onDragOver}>
          <ReactFlow
            nodes={displayNodes} edges={edges} nodeTypes={nodeTypes}
            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
            onNodeClick={(_, n) => setSelectedId(n.id)} onPaneClick={() => setSelectedId(null)}
            onNodeDoubleClick={(_, n) => {
              setSelectedId(n.id);
              if (n.type !== "generate") return;
              if ((n.data as AnyData).source === "word") setWordTemplateOpen(true);
              else setDocEditorOpen(true);
            }}
            deleteKeyCode={["Backspace", "Delete"]}
            defaultEdgeOptions={{
              type: "smoothstep",
              style: { stroke: "#A9A49A", strokeWidth: 1.6 },
              markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: "#A9A49A" },
            }}
            fitView proOptions={{ hideAttribution: true }}
          >
            <Background gap={18} size={1} color="var(--color-border)" />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable nodeColor="var(--color-primary)" maskColor="oklch(0.975 0.006 75 / 0.6)" />
          </ReactFlow>
          {nodes.length === 0 && (
            <p className="pointer-events-none absolute left-4 top-4 rounded-lg border border-border bg-card px-3 py-2 text-[12.5px] text-muted-foreground">Empieza con «Documento esperado»: lo que sube el usuario al crear un caso.</p>
          )}
        </div>

        <aside aria-label="Configuración de la etapa" className="flex min-h-0 flex-col overflow-y-auto border-l border-border bg-card">
          {!selected ? (
            <div className="flex flex-col gap-3 p-5">
              <h2 className="text-[15px] font-semibold">Elige una etapa</h2>
              <p className="text-[13px] leading-relaxed text-muted-foreground">Toca una etapa del lienzo para configurarla. El orden de un caso es: documentos esperados → extracción → cálculos → controles → documento a generar. Las notas son solo visuales.</p>
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3 border-b border-line-soft px-5 pb-3.5 pt-4">
                <div className="min-w-0">
                  <p className="text-[12.5px] text-muted-foreground">{KIND_META[selected.type as Kind]?.title}</p>
                  {/* An extraction has no name of its own: it is known by the document it reads. */}
                  <h2 className="truncate text-[17px] font-semibold tracking-[-0.01em]">{String((selected.data as AnyData).name || (selected.data as AnyData).label || (selected.type === "extract" && docTypeOpts.find((d) => d.key === (selected.data as AnyData).docTypeKey)?.name) || KIND_META[selected.type as Kind]?.title || "Etapa")}</h2>
                </div>
                <button type="button" onClick={() => setSelectedId(null)} aria-label="Cerrar" className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border text-foreground/70 hover:text-foreground"><X className="size-4" /></button>
              </div>
              <FieldNamesContext.Provider value={fieldNames}>
              <div className="flex flex-col gap-4 p-5">
                {selected.type === "intake"   && <IntakeForm   data={selected.data as AnyData} patch={patchSelected} order={intakeOrder.get(selected.id)} total={intakeOrder.size} onMove={(dir) => moveIntake(selected.id, dir)} />}
                {selected.type === "extract"  && <ExtractForm  data={selected.data as AnyData} patch={patchSelected} docTypes={docTypeOpts} onTrain={setVisualTraining} />}
                {selected.type === "calculate" && <CalculationForm key={selected.id} data={selected.data as AnyData} patch={patchSelected} docTypes={docTypeOpts} fieldsByType={fieldsByType} analysisNodes={analysisNodes} />}
                {selected.type === "validate" && <ValidateForm key={selected.id} data={selected.data as AnyData} patch={patchSelected} docTypes={docTypeOpts} fieldsByType={fieldsByType} />}
                {selected.type === "reference_lookup" && (
                  <div className="flex flex-col gap-4">
                    <p className={hlp}>Detecta los códigos de otros documentos que cita el caso, busca cada uno en el Archivo y compara si tratan el mismo asunto. Los enlaces dudosos se revisan en Archivo.</p>
                    <FieldRow label="Nombre de la etapa" help="Así aparece en el resultado del caso.">
                      <input className={inp} value={String((selected.data as AnyData).name ?? "")} onChange={(event) => patchSelected({ name: event.target.value })} />
                    </FieldRow>
                    <FieldRow label="Si un documento citado no está en el Archivo" help={SEVERITIES.find((s) => s.value === String((selected.data as AnyData).severity ?? "warn"))?.effect}>
                      <Select value={String((selected.data as AnyData).severity ?? "warn")} onChange={(value) => patchSelected({ severity: value })} options={SEVERITIES.map((s) => ({ value: s.value, label: s.label }))} />
                    </FieldRow>
                  </div>
                )}
                {selected.type === "generate" && <GenerateForm data={selected.data as AnyData} patch={patchSelected} onOpenEditor={() => setDocEditorOpen(true)} onOpenWordTemplate={() => setWordTemplateOpen(true)} />}
                {selected.type === "approval" && <ApprovalForm key={selected.id} data={selected.data as AnyData} patch={patchSelected} docTypes={docTypeOpts} fieldsByType={fieldsByType} />}
                {selected.type === "note" && <p className="text-[13px] leading-relaxed text-muted-foreground">Edita el texto directamente en el lienzo y ajusta su tamaño desde los bordes. Una nota no cambia el resultado del caso.</p>}
                <button type="button" onClick={deleteSelected} className="mt-2 inline-flex items-center gap-1.5 self-start text-[13px] font-semibold text-tone-err hover:underline"><Trash2 className="size-4" />Quitar esta etapa</button>
              </div>
              </FieldNamesContext.Provider>
            </>
          )}
        </aside>
      </div>

      {docEditorOpen && selected?.type === "generate" && (
        <DocEditor
          initialHtml={genInitialHtml(selected.data as AnyData)}
          fields={[...editorFields.values()]}
          onSave={(html) => { patchSelected({ html }); setDocEditorOpen(false); }}
          onClose={() => setDocEditorOpen(false)}
        />
      )}
      {wordTemplateOpen && selected?.type === "generate" && (
        <WordTemplateWorkspace
          flowId={flowId}
          nodeId={selected.id}
          fields={[...editorFields.values()]}
          initialTemplate={(selected.data as AnyData).wordTemplate as WordTemplateConfig | undefined}
          onSave={(wordTemplate) => { patchSelected({ source: "word", wordTemplate }); setWordTemplateOpen(false); }}
          onClose={() => setWordTemplateOpen(false)}
        />
      )}
      {panel === "publish" && <PublishDrawer nextVersion={(version ?? 0) + 1} changes={publishChanges} onClose={() => setPanel(null)} onPublish={publish} />}
      {panel === "test" && <TestDrawer {...test} onClose={() => setPanel(null)} />}
      {panel === "history" && <HistoryDrawer current={version} history={history} onClose={() => setPanel(null)} />}
      {visualTraining && <VisualTrainingWorkspace flowId={flowId} {...visualTraining} onClose={() => setVisualTraining(null)} />}
    </div>
  );
}

export function ContractFlowClient(props: { flowId: string }) {
  return (
    <ReactFlowProvider>
      <FlowBuilder {...props} />
    </ReactFlowProvider>
  );
}
