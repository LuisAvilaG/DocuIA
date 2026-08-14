"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface CustomFormGroup {
  id: string;
  name: string;
  subsidiary_ids: string[];
  invoice_customform_id?: string;
  po_customform_id?: string;
}

export interface CustomFormsConfig {
  global?: {
    invoice_customform_id?: string;
    po_customform_id?: string;
  };
  groups?: CustomFormGroup[];
  // Compatibilidad con la configuración anterior de un solo formulario global.
  invoice_customform_id?: string;
  po_customform_id?: string;
}

interface SubsidiaryOption {
  id: string;
  name: string;
}

function normalize(config: CustomFormsConfig): Required<Pick<CustomFormsConfig, "global" | "groups">> {
  return {
    global: {
      invoice_customform_id: config.global?.invoice_customform_id ?? config.invoice_customform_id ?? "",
      po_customform_id: config.global?.po_customform_id ?? config.po_customform_id ?? "",
    },
    groups: Array.isArray(config.groups) ? config.groups : [],
  };
}

export function CustomFormConfig({
  initialConfig,
  subsidiaries,
  disabled,
  onSave,
}: {
  initialConfig: CustomFormsConfig;
  subsidiaries: SubsidiaryOption[];
  disabled: boolean;
  onSave: (config: CustomFormsConfig) => Promise<boolean>;
}) {
  const [config, setConfig] = useState(() => normalize(initialConfig));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  function updateGlobal(key: "invoice_customform_id" | "po_customform_id", value: string) {
    setConfig(current => ({ ...current, global: { ...current.global, [key]: value } }));
  }

  function addGroup() {
    setConfig(current => ({
      ...current,
      groups: [...current.groups, {
        id: crypto.randomUUID(), name: `Grupo ${current.groups.length + 1}`,
        subsidiary_ids: [], invoice_customform_id: "", po_customform_id: "",
      }],
    }));
  }

  function updateGroup(id: string, patch: Partial<CustomFormGroup>) {
    setConfig(current => ({
      ...current,
      groups: current.groups.map(group => group.id === id ? { ...group, ...patch } : group),
    }));
  }

  function removeGroup(id: string) {
    setConfig(current => ({ ...current, groups: current.groups.filter(group => group.id !== id) }));
  }

  function isAssignedElsewhere(groupId: string, subsidiaryId: string) {
    return config.groups.some(group => group.id !== groupId && group.subsidiary_ids.includes(subsidiaryId));
  }

  async function save() {
    setSaving(true);
    setSaved(false);
    setError("");
    const invalidGroup = config.groups.find(group => !group.name.trim() || group.subsidiary_ids.length === 0);
    if (invalidGroup) {
      setSaving(false);
      setError("Cada grupo necesita nombre y al menos una subsidiaria.");
      return;
    }
    const ok = await onSave(config);
    setSaving(false);
    if (!ok) {
      setError("No se pudo guardar la configuración.");
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  return (
    <div className="border-t border-border/60 px-4 pb-4 pt-3 space-y-4">
      <div>
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Formularios globales</p>
        <p className="mt-1 text-xs text-muted-foreground">Se usan cuando la subsidiaria no pertenece a un grupo configurado.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Factura, Custom Form ID</Label>
          <Input value={config.global.invoice_customform_id} disabled={disabled || saving}
            onChange={e => updateGlobal("invoice_customform_id", e.target.value)} placeholder="Ej. 123" className="h-8 text-xs" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">PO, Custom Form ID</Label>
          <Input value={config.global.po_customform_id} disabled={disabled || saving}
            onChange={e => updateGlobal("po_customform_id", e.target.value)} placeholder="Ej. 456" className="h-8 text-xs" />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 pt-1">
        <div>
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Grupos de subsidiarias</p>
          <p className="mt-1 text-xs text-muted-foreground">Un grupo puede contener una o varias subsidiarias y reemplaza el formulario global.</p>
        </div>
        <button type="button" disabled={disabled || saving} onClick={addGroup}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50">
          <Plus className="w-3.5 h-3.5" /> Agregar grupo
        </button>
      </div>

      {config.groups.map((group, index) => (
        <div key={group.id} className="rounded-lg border border-border/70 bg-secondary/20 p-3 space-y-3">
          <div className="flex items-center gap-2">
            <Input value={group.name} disabled={disabled || saving} aria-label={`Nombre del grupo ${index + 1}`}
              onChange={e => updateGroup(group.id, { name: e.target.value })} className="h-8 text-xs font-medium" />
            <button type="button" disabled={disabled || saving} onClick={() => removeGroup(group.id)}
              aria-label={`Eliminar ${group.name || "grupo"}`} className="p-2 text-muted-foreground hover:text-destructive disabled:opacity-50">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Factura, Custom Form ID</Label>
              <Input value={group.invoice_customform_id ?? ""} disabled={disabled || saving}
                onChange={e => updateGroup(group.id, { invoice_customform_id: e.target.value })} placeholder="Ej. 123" className="h-8 text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">PO, Custom Form ID</Label>
              <Input value={group.po_customform_id ?? ""} disabled={disabled || saving}
                onChange={e => updateGroup(group.id, { po_customform_id: e.target.value })} placeholder="Ej. 456" className="h-8 text-xs" />
            </div>
          </div>
          <fieldset className="space-y-1.5">
            <legend className="text-xs font-medium text-muted-foreground">Subsidiarias</legend>
            <div className="flex flex-wrap gap-2">
              {subsidiaries.map(sub => {
                const checked = group.subsidiary_ids.includes(sub.id);
                const unavailable = !checked && isAssignedElsewhere(group.id, sub.id);
                return (
                  <label key={sub.id} className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${checked ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground"} ${unavailable ? "opacity-45" : "cursor-pointer"}`}>
                    <input type="checkbox" className="sr-only" checked={checked} disabled={disabled || saving || unavailable}
                      onChange={() => updateGroup(group.id, {
                        subsidiary_ids: checked
                          ? group.subsidiary_ids.filter(id => id !== sub.id)
                          : [...group.subsidiary_ids, sub.id],
                      })} />
                    {checked && <CheckCircle2 className="w-3 h-3" />}
                    {sub.name}
                  </label>
                );
              })}
            </div>
          </fieldset>
        </div>
      ))}

      {error && <p className="text-xs text-destructive">{error}</p>}
      <button type="button" onClick={save} disabled={disabled || saving}
        className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : saved ? <CheckCircle2 className="w-3.5 h-3.5" /> : null}
        {saving ? "Guardando formularios..." : saved ? "Formularios guardados" : "Guardar formularios"}
      </button>
    </div>
  );
}
