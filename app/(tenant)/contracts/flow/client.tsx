"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ReactFlow, Background, Controls, MiniMap, ReactFlowProvider, useReactFlow,
  useNodesState, useEdgesState, addEdge, Handle, Position, MarkerType,
  type Node, type Edge, type Connection, type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Loader2, Save, Plus, Trash2, FileInput, ListChecks, ShieldCheck, FileText, ChevronDown, ChevronUp,
} from "lucide-react";
import { DocEditor } from "./doc-editor";

// Seed the WYSIWYG editor from stored HTML, else migrate the old text body, else blank.
function genInitialHtml(data: Record<string, unknown>): string {
  if (typeof data.html === "string" && data.html.trim()) return data.html;
  const body = typeof data.body === "string" ? data.body : "";
  if (body.trim()) return body.split("\n").map((l) => `<p>${l.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`).join("");
  return "";
}

// ── Node kinds ────────────────────────────────────────────────────────
type Kind = "intake" | "extract" | "validate" | "generate";

const KIND_META: Record<Kind, { title: string; hint: string; Icon: typeof FileInput; hasIn: boolean; hasOut: boolean }> = {
  intake:   { title: "Entrada",    hint: "Qué documento entra",       Icon: FileInput,   hasIn: false, hasOut: true },
  extract:  { title: "Extracción", hint: "Qué datos saca la IA",       Icon: ListChecks,  hasIn: true,  hasOut: true },
  validate: { title: "Validación", hint: "Regla de cruce entre docs",  Icon: ShieldCheck, hasIn: true,  hasOut: true },
  generate: { title: "Generación", hint: "Documento final",            Icon: FileText,    hasIn: true,  hasOut: false },
};

type AnyData = Record<string, unknown>;

function defaultData(kind: Kind): AnyData {
  switch (kind) {
    case "intake":   return { docTypeKey: "nuevo_tipo", name: "Nuevo documento", hint: "" };
    case "extract":  return { docTypeKey: "nuevo_tipo", fields: [] };
    case "validate": return { name: "Nueva validación", rule: {
      kind: "cross_reference",
      subjects: { docType: "", field: "" },
      membership: { docType: "", field: "", label: "En documento" },
      statusLabels: { pass: "vigente", fail: "no_vigente", unknown: "indeterminado" },
    } };
    case "generate": return { templateKey: "salida", name: "Documento de salida", body: "" };
  }
}

const handleStyle = { width: 9, height: 9, background: "var(--color-primary)", border: "2px solid var(--color-card)" } as const;

// ── Canvas node renderer ──────────────────────────────────────────────
function NodeCard({ type, data, selected }: NodeProps) {
  const meta = KIND_META[(type as Kind)] ?? KIND_META.intake;
  const d = data as AnyData;
  const Icon = meta.Icon;
  const order = typeof d._order === "number" ? d._order : null;
  const summary =
    type === "intake"   ? String(d.name || d.docTypeKey || "Sin nombre") :
    type === "extract"  ? `${String(d.docTypeKey || "—")} · ${Array.isArray(d.fields) ? d.fields.length : 0} campos` :
    type === "validate" ? String(d.name || "Sin nombre") :
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
const inp = "w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15";
const lbl = "text-[11px] font-medium text-muted-foreground";

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block space-y-1"><span className={lbl}>{label}</span>{children}</label>;
}

interface DocTypeOpt { key: string; name: string }

function IntakeForm({ data, patch, order, total, onMove }: { data: AnyData; patch: (p: AnyData) => void; order?: number; total?: number; onMove?: (dir: -1 | 1) => void }) {
  return (
    <div className="space-y-3">
      {order != null && total != null && total > 1 && (
        <div className="flex items-center justify-between rounded-md border border-border bg-background/60 px-2.5 py-1.5">
          <span className="text-[11px] text-muted-foreground">Orden de entrada: <span className="text-foreground font-medium tabular-nums">#{order}</span> de {total}</span>
          <span className="flex items-center gap-1">
            <button onClick={() => onMove?.(-1)} disabled={order <= 1} className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-30" title="Subir"><ChevronUp className="w-3.5 h-3.5" /></button>
            <button onClick={() => onMove?.(1)} disabled={order >= total} className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-30" title="Bajar"><ChevronDown className="w-3.5 h-3.5" /></button>
          </span>
        </div>
      )}
      <FieldRow label="Nombre del documento"><input className={inp} value={String(data.name ?? "")} onChange={(e) => patch({ name: e.target.value })} placeholder="Contrato" /></FieldRow>
      <FieldRow label="Clave (key)"><input className={`${inp} font-mono`} value={String(data.docTypeKey ?? "")} onChange={(e) => patch({ docTypeKey: e.target.value })} placeholder="contrato" /></FieldRow>
      <FieldRow label="Pista para la IA (opcional)"><textarea rows={2} className={inp} value={String(data.hint ?? "")} onChange={(e) => patch({ hint: e.target.value })} placeholder="acuerdo comercial entre la sociedad y un tercero" /></FieldRow>
    </div>
  );
}

interface FieldT { fieldKey: string; label: string; isList: boolean }
function ExtractForm({ data, patch, docTypes }: { data: AnyData; patch: (p: AnyData) => void; docTypes: DocTypeOpt[] }) {
  const fields = (Array.isArray(data.fields) ? data.fields : []) as FieldT[];
  const set = (f: FieldT[]) => patch({ fields: f });
  return (
    <div className="space-y-3">
      <FieldRow label="Documento del que extrae">
        <Select value={String(data.docTypeKey ?? "")} onChange={(v) => patch({ docTypeKey: v })}
          options={docTypes.map((d) => ({ value: d.key, label: `${d.name} (${d.key})` }))} placeholder="Elige un documento de entrada" />
      </FieldRow>
      <div>
        <span className={lbl}>Campos a extraer</span>
        <div className="space-y-1.5 mt-1">
          {fields.map((f, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input className={`${inp} font-mono !py-1 w-24`} placeholder="key" value={f.fieldKey} onChange={(e) => set(fields.map((x, j) => j === i ? { ...x, fieldKey: e.target.value } : x))} />
              <input className={`${inp} !py-1`} placeholder="Etiqueta" value={f.label} onChange={(e) => set(fields.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} />
              <label className="flex items-center gap-1 text-[10px] text-muted-foreground shrink-0" title="Varios valores (lista)"><input type="checkbox" checked={!!f.isList} onChange={(e) => set(fields.map((x, j) => j === i ? { ...x, isList: e.target.checked } : x))} />lista</label>
              <button onClick={() => set(fields.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          ))}
          <button onClick={() => set([...fields, { fieldKey: "", label: "", isList: false }])} className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"><Plus className="w-3 h-3" /> Agregar campo</button>
        </div>
      </div>
    </div>
  );
}

interface RuleRef { docType: string; field: string; label?: string }

function RefEditor({ title, help, value, onChange, withLabel, docTypes, fieldsByType }: {
  title: string; help: string; value?: { docType?: string; field?: string; label?: string }; onChange: (r: RuleRef) => void; withLabel?: boolean;
  docTypes: DocTypeOpt[]; fieldsByType: Record<string, string[]>;
}) {
  const v = { docType: value?.docType ?? "", field: value?.field ?? "", label: value?.label ?? "" };
  const fieldOpts = (fieldsByType[v.docType] ?? []).map((f) => ({ value: f, label: f }));
  return (
    <div className="rounded-md border border-border bg-background/60 p-2.5 space-y-1.5">
      <div><p className="text-[11px] font-semibold text-foreground">{title}</p><p className="text-[10px] text-muted-foreground">{help}</p></div>
      <div className="grid grid-cols-2 gap-1.5">
        <Select value={v.docType} onChange={(val) => onChange({ ...v, docType: val, field: "" })} options={docTypes.map((d) => ({ value: d.key, label: d.name }))} placeholder="Documento" />
        <Select value={v.field} onChange={(val) => onChange({ ...v, field: val })} options={fieldOpts} placeholder={v.docType ? "Campo" : "elige doc"} disabled={!v.docType} />
      </div>
      {withLabel && <input className={`${inp} !py-1`} placeholder="Texto legible (ej. En escritura de poderes)" value={v.label ?? ""} onChange={(e) => onChange({ ...v, label: e.target.value })} />}
    </div>
  );
}

// Plain doc+field picker (no label) for rule refs.
function DocFieldPicker({ label, docType, field, onChange, docTypes, fieldsByType }: { label: string; docType: string; field: string; onChange: (v: { docType: string; field: string }) => void; docTypes: DocTypeOpt[]; fieldsByType: Record<string, string[]> }) {
  return (
    <div>
      <span className={lbl}>{label}</span>
      <div className="grid grid-cols-2 gap-1.5 mt-1">
        <Select value={docType} onChange={(v) => onChange({ docType: v, field: "" })} options={docTypes.map((d) => ({ value: d.key, label: d.name }))} placeholder="Documento" />
        <Select value={field} onChange={(v) => onChange({ docType, field: v })} options={(fieldsByType[docType] ?? []).map((f) => ({ value: f, label: f }))} placeholder={docType ? "Campo" : "elige doc"} disabled={!docType} />
      </div>
    </div>
  );
}

const RULE_KINDS = [
  { value: "cross_reference", label: "Presencia cruzada — aparece en otro doc" },
  { value: "field_match", label: "Coincidencia de campos" },
  { value: "clause_presence", label: "Revisión de cláusula" },
  { value: "numeric_threshold", label: "Umbral numérico" },
  { value: "date_rule", label: "Regla de fecha / vigencia" },
  { value: "field_format", label: "Formato / ID fiscal" },
  { value: "document_required", label: "Documento requerido" },
  { value: "signatures_complete", label: "Firmas completas" },
];
const RULE_INFO: Record<string, string> = {
  cross_reference: "Comprueba que cada elemento de una lista (ej. los representantes del contrato) APAREZCA en otro documento (ej. la escritura de poderes). Opcional: confirmarlo con un tercer documento (ej. certificado de vigencia).",
  field_match: "Compara dos campos entre documentos y exige que coincidan (o que difieran). Ej: el monto del contrato = el del certificado; el mismo ID fiscal en ambos.",
  clause_presence: "Verifica que un documento incluya (o NO incluya) una cláusula. La cláusula se captura como un campo en la etapa de Extracción; aquí decides si debe estar o no.",
  numeric_threshold: "Verifica que un valor numérico esté dentro de un mínimo/máximo. Ej: monto ≤ tope; porcentaje de garantía ≥ mínimo.",
  date_rule: "Valida fechas: que no esté vencida y/o que sea anterior a otra fecha. Ej: la vigencia sigue vigente; el inicio es anterior al término.",
  field_format: "Verifica el formato de un campo: identificación fiscal por país (RUT, RFC, CUIT, NIT, CNPJ…), correo, fecha, número, o simplemente que no esté vacío.",
  document_required: "Exige que el caso incluya ciertos tipos de documento. Ej: contrato + escritura + certificado. Marca los que falten.",
  signatures_complete: "Verifica que todas las partes esperadas hayan firmado el documento.",
};
const COUNTRIES = ["CL", "MX", "AR", "CO", "PE", "EC", "BR", "PY"].map((c) => ({ value: c, label: c }));
const FORMATS = [
  { value: "tax_id", label: "ID fiscal (RUT/RFC/CUIT…)" },
  { value: "email", label: "Correo" },
  { value: "date", label: "Fecha" },
  { value: "number", label: "Número" },
  { value: "nonempty", label: "No vacío (obligatorio)" },
];
const SEVERITIES: { value: "info" | "warn" | "block"; label: string; cls: string }[] = [
  { value: "info",  label: "OK / Info",   cls: "border-success/50 bg-success/10 text-success" },
  { value: "warn",  label: "Advertencia", cls: "border-warning/50 bg-warning/10 text-warning" },
  { value: "block", label: "Bloqueante",  cls: "border-destructive/50 bg-destructive/10 text-destructive" },
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
    default:                    return { kind: "cross_reference", subjects: { docType: "", field: "" }, membership: { docType: "", field: "", label: "En documento" }, statusLabels: { pass: "válido", fail: "no válido", unknown: "indeterminado" } };
  }
}

function ValidateForm({ data, patch, docTypes, fieldsByType }: { data: AnyData; patch: (p: AnyData) => void; docTypes: DocTypeOpt[]; fieldsByType: Record<string, string[]> }) {
  const rule = (data.rule ?? defaultRule("cross_reference")) as { kind: string } & Record<string, unknown>;
  const kind = String(rule.kind ?? "cross_reference");
  const severity = String(data.severity ?? "warn");
  const setRule = (r: Record<string, unknown>) => patch({ rule: { ...rule, ...r } });
  const ref = (k: string) => (rule[k] as { docType?: string; field?: string; label?: string } | undefined) ?? {};
  const numStr = (v: unknown) => (v === undefined || v === null ? "" : String(v));

  return (
    <div className="space-y-3">
      <FieldRow label="Nombre / etiqueta"><input className={inp} value={String(data.name ?? "")} onChange={(e) => patch({ name: e.target.value })} placeholder="Ej. Validación de firmantes" /></FieldRow>

      <FieldRow label="Tipo de validación"><Select value={kind} onChange={(k) => patch({ rule: defaultRule(k) })} options={RULE_KINDS} /></FieldRow>
      <p className="rounded-md bg-secondary/50 border border-border px-2.5 py-2 text-[11px] text-muted-foreground leading-relaxed">{RULE_INFO[kind]}</p>

      <div>
        <span className={lbl}>Severidad del semáforo</span>
        <p className="text-[10px] text-muted-foreground mt-0.5 mb-1">Se enciende <strong className="text-foreground font-medium">cuando la validación NO se cumple</strong>. Si se cumple, queda en verde. Elige qué tan grave es la falla:</p>
        <div className="grid grid-cols-3 gap-1.5">
          {SEVERITIES.map((s) => (
            <button key={s.value} type="button" onClick={() => patch({ severity: s.value })}
              className={`rounded-md border px-2 py-1 text-[10px] font-medium transition-colors ${severity === s.value ? s.cls : "border-border text-muted-foreground hover:bg-secondary"}`}>{s.label}</button>
          ))}
        </div>
        <ul className="mt-1.5 space-y-0.5 text-[10px] text-muted-foreground">
          <li><span className="text-destructive font-medium">Bloqueante</span>: si falla, el caso queda en rojo y no se puede aprobar.</li>
          <li><span className="text-warning font-medium">Advertencia</span>: si falla, el caso queda en ámbar (se puede aprobar, pero avisa).</li>
          <li><span className="text-success font-medium">OK / Info</span>: informativo; nunca bloquea.</li>
        </ul>
      </div>

      {kind === "cross_reference" && (() => {
        const sl = (rule.statusLabels as { pass: string; fail: string; unknown: string }) ?? { pass: "válido", fail: "no válido", unknown: "indeterminado" };
        const hasConf = !!rule.confirmation;
        return (
          <>
            <RefEditor title="Sujetos" help="A quién se valida (cada elemento de la lista)" value={ref("subjects")} onChange={(r) => setRule({ subjects: r })} docTypes={docTypes} fieldsByType={fieldsByType} />
            <RefEditor title="Pertenencia" help="Dónde deben aparecer para ser válidos" value={ref("membership")} onChange={(r) => setRule({ membership: r })} withLabel docTypes={docTypes} fieldsByType={fieldsByType} />
            <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <input type="checkbox" checked={hasConf} onChange={(e) => setRule({ confirmation: e.target.checked ? { docType: "", field: "", label: "Confirmación" } : undefined })} />
              Requiere documento de confirmación
            </label>
            {hasConf && <RefEditor title="Confirmación" help="Campo que indica revocación / invalidez" value={ref("confirmation")} onChange={(r) => setRule({ confirmation: r })} withLabel docTypes={docTypes} fieldsByType={fieldsByType} />}
            <div><span className={lbl}>Etiquetas de estado</span>
              <div className="grid grid-cols-3 gap-1.5 mt-1">
                <input className={`${inp} !py-1`} title="cumple" value={sl.pass} onChange={(e) => setRule({ statusLabels: { ...sl, pass: e.target.value } })} />
                <input className={`${inp} !py-1`} title="falla" value={sl.fail} onChange={(e) => setRule({ statusLabels: { ...sl, fail: e.target.value } })} />
                <input className={`${inp} !py-1`} title="dudoso" value={sl.unknown} onChange={(e) => setRule({ statusLabels: { ...sl, unknown: e.target.value } })} />
              </div>
            </div>
          </>
        );
      })()}

      {kind === "field_match" && (
        <>
          <DocFieldPicker label="Campo A" docType={ref("left").docType ?? ""} field={ref("left").field ?? ""} onChange={(v) => setRule({ left: v })} docTypes={docTypes} fieldsByType={fieldsByType} />
          <DocFieldPicker label="Campo B" docType={ref("right").docType ?? ""} field={ref("right").field ?? ""} onChange={(v) => setRule({ right: v })} docTypes={docTypes} fieldsByType={fieldsByType} />
          <FieldRow label="Condición"><Select value={String(rule.mode ?? "equal")} onChange={(v) => setRule({ mode: v })} options={[{ value: "equal", label: "Deben coincidir" }, { value: "different", label: "Deben diferir" }]} /></FieldRow>
          <FieldRow label="Tolerancia numérica (opcional)"><input type="number" className={inp} value={numStr(rule.numericTolerance)} onChange={(e) => setRule({ numericTolerance: e.target.value === "" ? undefined : Number(e.target.value) })} placeholder="0" /></FieldRow>
        </>
      )}

      {kind === "clause_presence" && (
        <>
          <DocFieldPicker label="Documento y campo de la cláusula" docType={String(rule.docType ?? "")} field={String(rule.field ?? "")} onChange={(v) => setRule(v)} docTypes={docTypes} fieldsByType={fieldsByType} />
          <FieldRow label="Regla"><Select value={rule.mustExist === false ? "no" : "si"} onChange={(v) => setRule({ mustExist: v === "si" })} options={[{ value: "si", label: "Debe incluir la cláusula" }, { value: "no", label: "NO debe incluir la cláusula" }]} /></FieldRow>
          <p className="text-[10px] text-muted-foreground">La cláusula se captura como un campo en la etapa de Extracción (la IA la detecta por significado).</p>
        </>
      )}

      {kind === "numeric_threshold" && (
        <>
          <DocFieldPicker label="Documento y campo numérico" docType={String(rule.docType ?? "")} field={String(rule.field ?? "")} onChange={(v) => setRule(v)} docTypes={docTypes} fieldsByType={fieldsByType} />
          <div className="grid grid-cols-2 gap-1.5">
            <FieldRow label="Mínimo"><input type="number" className={inp} value={numStr(rule.min)} onChange={(e) => setRule({ min: e.target.value === "" ? undefined : Number(e.target.value) })} /></FieldRow>
            <FieldRow label="Máximo"><input type="number" className={inp} value={numStr(rule.max)} onChange={(e) => setRule({ max: e.target.value === "" ? undefined : Number(e.target.value) })} /></FieldRow>
          </div>
        </>
      )}

      {kind === "date_rule" && (
        <>
          <DocFieldPicker label="Documento y campo de fecha" docType={String(rule.docType ?? "")} field={String(rule.field ?? "")} onChange={(v) => setRule(v)} docTypes={docTypes} fieldsByType={fieldsByType} />
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><input type="checkbox" checked={rule.notExpired !== false} onChange={(e) => setRule({ notExpired: e.target.checked })} /> No debe estar vencida</label>
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><input type="checkbox" checked={!!rule.before} onChange={(e) => setRule({ before: e.target.checked ? { docType: "", field: "" } : undefined })} /> Debe ser anterior a otra fecha</label>
          {rule.before != null && <DocFieldPicker label="Fecha posterior (referencia)" docType={ref("before").docType ?? ""} field={ref("before").field ?? ""} onChange={(v) => setRule({ before: v })} docTypes={docTypes} fieldsByType={fieldsByType} />}
        </>
      )}

      {kind === "field_format" && (
        <>
          <DocFieldPicker label="Documento y campo" docType={String(rule.docType ?? "")} field={String(rule.field ?? "")} onChange={(v) => setRule(v)} docTypes={docTypes} fieldsByType={fieldsByType} />
          <FieldRow label="Formato"><Select value={String(rule.format ?? "nonempty")} onChange={(v) => setRule({ format: v })} options={FORMATS} /></FieldRow>
          {rule.format === "tax_id" && <FieldRow label="País del ID fiscal"><Select value={String(rule.country ?? "")} onChange={(v) => setRule({ country: v || undefined })} options={COUNTRIES} placeholder="Genérico" /></FieldRow>}
        </>
      )}

      {kind === "document_required" && (
        <div>
          <span className={lbl}>Documentos obligatorios en el caso</span>
          <div className="space-y-1 mt-1">
            {docTypes.length === 0 && <p className="text-[11px] text-muted-foreground">Agrega nodos de Entrada primero.</p>}
            {docTypes.map((d) => {
              const list = (rule.docTypes as string[]) ?? [];
              const on = list.includes(d.key);
              return <label key={d.key} className="flex items-center gap-2 text-xs text-foreground"><input type="checkbox" checked={on} onChange={(e) => setRule({ docTypes: e.target.checked ? [...list, d.key] : list.filter((x) => x !== d.key) })} /> {d.name}</label>;
            })}
          </div>
        </div>
      )}

      {kind === "signatures_complete" && (
        <>
          <DocFieldPicker label="Partes esperadas" docType={ref("subjects").docType ?? ""} field={ref("subjects").field ?? ""} onChange={(v) => setRule({ subjects: v })} docTypes={docTypes} fieldsByType={fieldsByType} />
          <DocFieldPicker label="Firmas registradas" docType={ref("signatures").docType ?? ""} field={ref("signatures").field ?? ""} onChange={(v) => setRule({ signatures: v })} docTypes={docTypes} fieldsByType={fieldsByType} />
        </>
      )}
    </div>
  );
}

function GenerateForm({ data, patch, onOpenEditor }: { data: AnyData; patch: (p: AnyData) => void; onOpenEditor: () => void }) {
  const hasContent = !!(data.html || data.body);
  return (
    <div className="space-y-3">
      <FieldRow label="Nombre del documento"><input className={inp} value={String(data.name ?? "")} onChange={(e) => patch({ name: e.target.value })} placeholder="Cotización" /></FieldRow>
      <button onClick={onOpenEditor}
        className="w-full flex items-center justify-center gap-2 rounded-lg bg-primary text-primary-foreground px-4 py-3 text-sm font-medium shadow-[0_1px_3px_oklch(0.48_0.15_182_/_0.3)] hover:bg-primary/90 transition-colors">
        <FileText className="w-4 h-4" /> Abrir editor del documento
      </button>
      <p className="text-[11px] text-muted-foreground leading-relaxed">Diseña el documento como en Word: títulos, negrita, colores, listas, <strong className="text-foreground font-medium">tablas</strong>, <strong className="text-foreground font-medium">imágenes/logo</strong>, e inserta campos del caso. Se exporta a PDF. {hasContent ? "Ya tiene contenido guardado." : "Aún sin contenido."}</p>
      <p className="text-[10px] text-muted-foreground">Tip: también puedes hacer <strong className="text-foreground font-medium">doble clic</strong> en el nodo de Generación para abrirlo.</p>
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
        <ChevronDown className={`w-3 h-3 text-muted-foreground shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && !disabled && (
        <div className="absolute z-50 mt-1 w-full max-h-52 overflow-y-auto rounded-md border border-border bg-popover py-1 shadow-[0_8px_32px_oklch(0.18_0.015_258_/_0.12)]">
          {options.length === 0 && <p className="px-2.5 py-1.5 text-[11px] text-muted-foreground">Sin opciones</p>}
          {options.map((o) => (
            <button key={o.value} type="button" onClick={() => { onChange(o.value); setOpen(false); }}
              className={`w-full text-left px-2.5 py-1.5 text-xs transition-colors hover:bg-secondary ${o.value === value ? "bg-primary/5 text-primary font-medium" : "text-foreground"}`}>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Builder (edits ONE flow, identified by flowId) ────────────────────
function FlowBuilder({ flowId }: { flowId: string }) {
  const rf = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [name, setName] = useState("Flujo de contratos");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [docEditorOpen, setDocEditorOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const nodeTypes = useMemo(() => ({ intake: NodeCard, extract: NodeCard, validate: NodeCard, generate: NodeCard }), []);

  const setGraph = useCallback((graph: { nodes?: Array<{ id: string; kind: Kind; position: { x: number; y: number }; data: AnyData }>; edges?: Array<{ id: string; source: string; target: string }> }) => {
    setNodes((graph.nodes ?? []).map((n) => ({ id: n.id, type: n.kind, position: n.position, data: n.data })));
    setEdges((graph.edges ?? []).map((e) => ({ id: e.id, source: e.source, target: e.target })));
  }, [setNodes, setEdges]);

  useEffect(() => {
    (async () => {
      try {
        const d = await fetch(`/api/v1/contracts/flow/${flowId}`).then((r) => r.json());
        if (d.flow) { setName(d.flow.name ?? "Flujo"); setGraph(d.flow.graph ?? { nodes: [], edges: [] }); }
      } finally { setLoading(false); }
    })();
  }, [flowId, setGraph]);

  const onConnect = useCallback((c: Connection) =>
    setEdges((eds) => addEdge({ ...c, id: `e_${c.source}_${c.target}_${crypto.randomUUID().slice(0, 6)}` }, eds)), [setEdges]);

  const addNode = (kind: Kind, at?: { x: number; y: number }) => {
    const id = `${kind}_${crypto.randomUUID().slice(0, 8)}`;
    setNodes((ns) => [...ns, { id, type: kind, position: at ?? { x: 80 + (ns.length % 4) * 70, y: 70 + ns.length * 28 }, data: defaultData(kind) }]);
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

  async function save() {
    setSaving(true); setMsg(null);
    const graph = {
      nodes: nodes.map((n) => ({ id: n.id, kind: n.type, position: { x: Math.round(n.position.x), y: Math.round(n.position.y) }, data: n.data })),
      edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
    };
    try {
      const res = await fetch(`/api/v1/contracts/flow/${flowId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, graph }) });
      const d = await res.json();
      setMsg(res.ok ? { ok: true, text: `Guardado (v${d.version ?? 1})` } : { ok: false, text: d.error ?? "Error al guardar" });
    } catch { setMsg({ ok: false, text: "Sin conexión" }); }
    finally { setSaving(false); }
  }

  const selected = nodes.find((n) => n.id === selectedId) ?? null;

  const docTypeOpts: DocTypeOpt[] = nodes.filter((n) => n.type === "intake")
    .map((n) => ({ key: String((n.data as AnyData).docTypeKey ?? ""), name: String((n.data as AnyData).name || (n.data as AnyData).docTypeKey || "") }))
    .filter((d) => d.key);
  const fieldsByType: Record<string, string[]> = {};
  for (const n of nodes.filter((n) => n.type === "extract")) {
    const k = String((n.data as AnyData).docTypeKey ?? "");
    if (!k) continue;
    const fs = (Array.isArray((n.data as AnyData).fields) ? (n.data as AnyData).fields as FieldT[] : []).map((f) => f.fieldKey).filter(Boolean);
    (fieldsByType[k] ??= []).push(...fs);
  }
  const allFields = [...new Set(Object.values(fieldsByType).flat())].concat("_validations");

  // Number the intake documents top-to-bottom so "which comes first" is visible.
  const intakeOrder = new Map(
    nodes.filter((n) => n.type === "intake").sort((a, b) => a.position.y - b.position.y).map((n, i) => [n.id, i + 1]),
  );
  const displayNodes = nodes.map((n) => n.type === "intake" ? { ...n, data: { ...n.data, _order: intakeOrder.get(n.id) } } : n);

  if (loading) return <div className="flex-1 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <header className="border-b border-border px-5 py-3 shrink-0 flex items-center gap-3 flex-wrap">
        <div className="mr-auto min-w-0">
          <Link href="/contracts/flow" className="text-[11px] text-muted-foreground hover:text-foreground">← Flujos</Link>
          <input value={name} onChange={(e) => setName(e.target.value)}
            className="block bg-transparent text-base font-semibold tracking-[-0.01em] text-foreground outline-none border-b border-transparent focus:border-border mt-1 min-w-0" />
        </div>
        {msg && <span className={`text-xs ${msg.ok ? "text-success" : "text-destructive"}`}>{msg.text}</span>}
        <button onClick={save} disabled={saving}
          className="inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-4 py-2 text-xs font-medium shadow-[0_1px_3px_oklch(0.48_0.15_182_/_0.3)] hover:bg-primary/90 disabled:opacity-60 transition-colors">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Guardar flujo
        </button>
      </header>

      <div className="flex-1 flex min-h-0">
        <div className="flex-1 min-h-0 bg-background" style={{ minHeight: 480 }} onDrop={onDrop} onDragOver={onDragOver}>
          <ReactFlow
            nodes={displayNodes} edges={edges} nodeTypes={nodeTypes}
            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
            onNodeClick={(_, n) => setSelectedId(n.id)} onPaneClick={() => setSelectedId(null)}
            onNodeDoubleClick={(_, n) => { setSelectedId(n.id); if (n.type === "generate") setDocEditorOpen(true); }}
            deleteKeyCode={["Backspace", "Delete"]}
            defaultEdgeOptions={{
              type: "smoothstep",
              style: { stroke: "var(--color-muted-foreground)", strokeWidth: 2 },
              markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: "var(--color-muted-foreground)" },
            }}
            fitView proOptions={{ hideAttribution: true }}
          >
            <Background gap={18} size={1} color="var(--color-border)" />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable nodeColor="var(--color-primary)" maskColor="oklch(0.975 0.006 75 / 0.6)" />
          </ReactFlow>
        </div>

        <aside className="w-80 shrink-0 border-l border-border overflow-y-auto bg-card">
          {!selected ? (
            <div className="p-5 space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Agrega una etapa</h2>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed"><strong className="text-foreground font-medium">Arrastra</strong> una tarjeta al lienzo (o haz clic para añadirla), luego conecta los nodos arrastrando del punto derecho de uno al izquierdo del siguiente. Orden: Entrada → Extracción → Validación → Generación.</p>
              </div>
              <div className="space-y-2">
                {(Object.keys(KIND_META) as Kind[]).map((k, i) => {
                  const M = KIND_META[k];
                  return (
                    <button key={k} onClick={() => addNode(k)} draggable
                      onDragStart={(e) => { e.dataTransfer.setData("application/flowkind", k); e.dataTransfer.effectAllowed = "copy"; }}
                      className="w-full flex items-center gap-3 rounded-lg border border-border bg-background hover:border-primary/50 hover:bg-primary/5 p-3 text-left transition-colors cursor-grab active:cursor-grabbing group">
                      <span className="w-8 h-8 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0"><M.Icon className="w-4 h-4" /></span>
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-foreground">{i + 1}. {M.title}</p>
                        <p className="text-[11px] text-muted-foreground">{M.hint}</p>
                      </div>
                      <Plus className="w-3.5 h-3.5 text-muted-foreground ml-auto shrink-0 group-hover:text-primary" />
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed border-t border-border pt-3">Todo lo que el motor hace con un caso sale de este flujo. Haz clic en un nodo para configurarlo.</p>
            </div>
          ) : (
            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground">
                  {(() => { const M = KIND_META[selected.type as Kind]; return M ? <M.Icon className="w-3.5 h-3.5 text-primary" /> : null; })()}
                  {KIND_META[selected.type as Kind]?.title}
                </span>
                <button onClick={deleteSelected} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive"><Trash2 className="w-3.5 h-3.5" /> Eliminar</button>
              </div>
              {selected.type === "intake"   && <IntakeForm   data={selected.data as AnyData} patch={patchSelected} order={intakeOrder.get(selected.id)} total={intakeOrder.size} onMove={(dir) => moveIntake(selected.id, dir)} />}
              {selected.type === "extract"  && <ExtractForm  data={selected.data as AnyData} patch={patchSelected} docTypes={docTypeOpts} />}
              {selected.type === "validate" && <ValidateForm data={selected.data as AnyData} patch={patchSelected} docTypes={docTypeOpts} fieldsByType={fieldsByType} />}
              {selected.type === "generate" && <GenerateForm data={selected.data as AnyData} patch={patchSelected} onOpenEditor={() => setDocEditorOpen(true)} />}
            </div>
          )}
        </aside>
      </div>

      {docEditorOpen && selected?.type === "generate" && (
        <DocEditor
          initialHtml={genInitialHtml(selected.data as AnyData)}
          fields={allFields}
          onSave={(html) => { patchSelected({ html }); setDocEditorOpen(false); }}
          onClose={() => setDocEditorOpen(false)}
        />
      )}
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
