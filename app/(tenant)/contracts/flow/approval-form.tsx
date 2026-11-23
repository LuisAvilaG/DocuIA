"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

type AnyData = Record<string, unknown>;
interface Approvers { mode: "any" | "users"; userIds: string[] }
interface Condition { label: string; docType: string; field: string; op: "gt" | "gte"; value: number; approvers: Approvers }
interface Person { id: string; name: string; role: string }
interface DocTypeOpt { key: string; name: string }

const inp = "w-full min-h-9 rounded-lg border border-[#D6D2C8] bg-white px-2.5 text-[13px] outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";
const ANY: Approvers = { mode: "any", userIds: [] };

function asApprovers(v: unknown): Approvers {
  const a = (v ?? {}) as Partial<Approvers>;
  return { mode: a.mode === "users" ? "users" : "any", userIds: Array.isArray(a.userIds) ? a.userIds : [] };
}

/** Elige quién aprueba: cualquiera con permiso, o personas concretas. */
function ApproverPicker({ value, onChange, people, anyLabel = "Cualquier persona con permiso de aprobar" }: { value: Approvers; onChange: (v: Approvers) => void; people: Person[]; anyLabel?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <select className={inp} value={value.mode} onChange={(e) => onChange({ mode: e.target.value as Approvers["mode"], userIds: value.userIds })}>
        <option value="any">{anyLabel}</option>
        <option value="users">Personas específicas</option>
      </select>
      {value.mode === "users" && (
        <div className="flex flex-wrap gap-1.5">
          {people.length === 0 && <span className="text-xs text-muted-foreground">No hay administradores ni aprobadores activos.</span>}
          {people.map((p) => {
            const on = value.userIds.includes(p.id);
            return (
              <button key={p.id} type="button" aria-pressed={on}
                onClick={() => onChange({ mode: "users", userIds: on ? value.userIds.filter((x) => x !== p.id) : [...value.userIds, p.id] })}
                className={cn("rounded-full border px-2.5 py-1 text-xs", on ? "border-primary bg-tone-info-bg font-semibold text-tone-info" : "border-[#D6D2C8] bg-white text-foreground/75")}>
                {p.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Formulario de la etapa Aprobación: reglas en orden, excepción y recordatorio (este último en Ajustes). */
export function ApprovalForm({ data, patch, docTypes, fieldsByType }: { data: AnyData; patch: (p: AnyData) => void; docTypes: DocTypeOpt[]; fieldsByType: Record<string, string[]> }) {
  const [people, setPeople] = useState<Person[]>([]);
  useEffect(() => {
    fetch("/api/v1/contracts/approvers").then((r) => r.json()).then((d) => setPeople(Array.isArray(d.users) ? d.users : [])).catch(() => setPeople([]));
  }, []);

  const base = asApprovers(data.base);
  const conditions = (Array.isArray(data.conditions) ? data.conditions : []) as Condition[];
  const exceptionUserIds = (Array.isArray(data.exceptionUserIds) ? data.exceptionUserIds : []) as string[];
  const setCond = (i: number, p: Partial<Condition>) => patch({ conditions: conditions.map((c, k) => (k === i ? { ...c, ...p } : c)) });

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-[13px] font-semibold">Nombre de la etapa
        <input className={inp} value={String(data.name ?? "")} onChange={(e) => patch({ name: e.target.value })} />
      </label>

      <div>
        <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.05em] text-foreground/75">Reglas, en orden</span>
        <div className="flex flex-col gap-2.5">
          <div className="rounded-[10px] border border-border bg-background p-3">
            <header className="mb-2 flex items-center justify-between"><b className="text-[13.5px] font-semibold">Siempre</b><span className="rounded-md bg-tone-mute-bg px-2 py-0.5 text-xs">1 aprobación</span></header>
            <span className="mb-1 block text-xs text-muted-foreground">Decide</span>
            <ApproverPicker value={base} onChange={(v) => patch({ base: v })} people={people} />
          </div>

          {conditions.map((c, i) => (
            <div key={i} className="rounded-[10px] border border-border bg-background p-3">
              <header className="mb-2 flex items-center justify-between">
                <b className="text-[13.5px] font-semibold">Además, si…</b>
                <button type="button" onClick={() => patch({ conditions: conditions.filter((_, k) => k !== i) })} aria-label="Quitar condición" className="text-muted-foreground hover:text-tone-err"><Trash2 className="size-4" /></button>
              </header>
              <div className="grid grid-cols-2 gap-2">
                <select className={inp} aria-label="Documento" value={c.docType} onChange={(e) => setCond(i, { docType: e.target.value, field: "" })}>
                  <option value="">Documento…</option>
                  {docTypes.map((d) => <option key={d.key} value={d.key}>{d.name}</option>)}
                </select>
                <select className={inp} aria-label="Dato" value={c.field} onChange={(e) => setCond(i, { field: e.target.value })} disabled={!c.docType}>
                  <option value="">Dato…</option>
                  {(fieldsByType[c.docType] ?? []).map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
                <select className={inp} aria-label="Comparación" value={c.op} onChange={(e) => setCond(i, { op: e.target.value as Condition["op"] })}>
                  <option value="gt">es mayor que</option>
                  <option value="gte">es mayor o igual que</option>
                </select>
                <input className={cn(inp, "tabular-nums")} aria-label="Valor" type="number" value={Number.isFinite(c.value) ? c.value : 0} onChange={(e) => setCond(i, { value: Number(e.target.value) })} />
              </div>
              <span className="mb-1 mt-2.5 block text-xs text-muted-foreground">decide también</span>
              <ApproverPicker value={asApprovers(c.approvers)} onChange={(v) => setCond(i, { approvers: v })} people={people} anyLabel="Otra persona con permiso de aprobar" />
              <input className={cn(inp, "mt-2")} placeholder="Nombre corto (ej. Gerencia si supera $500 M)" value={c.label} onChange={(e) => setCond(i, { label: e.target.value })} />
            </div>
          ))}
          {conditions.length < 5 && (
            <button type="button" onClick={() => patch({ conditions: [...conditions, { label: "", docType: "", field: "", op: "gt", value: 0, approvers: ANY }] })}
              className="inline-flex items-center gap-1.5 self-start text-[13px] font-semibold text-link hover:underline"><Plus className="size-4" />Agregar condición</button>
          )}
        </div>
      </div>

      <div>
        <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.05em] text-foreground/75">Aprobar con excepción</span>
        <p className="mb-2 text-[13px]">Cuando hay un bloqueo, solo pueden aprobar:</p>
        <div className="flex flex-wrap gap-1.5">
          {people.map((p) => {
            const on = exceptionUserIds.includes(p.id);
            return (
              <button key={p.id} type="button" aria-pressed={on} onClick={() => patch({ exceptionUserIds: on ? exceptionUserIds.filter((x) => x !== p.id) : [...exceptionUserIds, p.id] })}
                className={cn("rounded-full border px-2.5 py-1 text-xs", on ? "border-primary bg-tone-info-bg font-semibold text-tone-info" : "border-[#D6D2C8] bg-white text-foreground/75")}>
                {p.name}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">{exceptionUserIds.length ? "Solo las personas marcadas." : "Sin marcar: cualquiera que pueda decidir el caso."}</p>
      </div>

      <p className="rounded-lg bg-background px-3 py-2.5 text-xs text-muted-foreground">«Quien crea el caso no puede aprobarlo» y el recordatorio en días hábiles se ajustan en la función Aprobación por reglas. Esta etapa solo aplica si esa función está activa.</p>
    </div>
  );
}
