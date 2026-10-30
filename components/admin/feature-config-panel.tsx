"use client";

import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Field, TextInput, Select, control } from "@/components/admin/form";
import { Pill } from "@/components/admin/ui";
import { CustomFormConfig, type CustomFormsConfig } from "@/components/admin/custom-form-config";
import { cn } from "@/lib/utils";

export interface ConfigParam {
  key: string; label: string; type: "boolean" | "number" | "string" | "select";
  min?: number; max?: number; options?: string[]; optionLabels?: Record<string, string>; description?: string;
}

export interface ConfigurableFeature {
  id: string; name: string; description: string | null;
  featureType: "boolean" | "config" | "boolean_config";
  configSchema: ConfigParam[] | null;
  config: Record<string, unknown>; notes: string | null; adminGranted: boolean;
}

/**
 * Right-hand drawer that edits one feature's parameters and the admin note.
 * Saves explicitly (no blur-saves), so a half-typed value never hits the API.
 */
export function FeatureConfigPanel({ feature, subsidiaries, onClose, onSave }: {
  feature: ConfigurableFeature;
  subsidiaries: Array<{ id: string; name: string }>;
  onClose: () => void;
  onSave: (config: Record<string, unknown>, notes: string) => Promise<boolean>;
}) {
  const [config, setConfig] = useState<Record<string, unknown>>(feature.config ?? {});
  const [notes, setNotes] = useState(feature.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape" && !saving) onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const isCustomForms = feature.id === "custom_netsuite_forms";
  const set = (key: string, value: unknown) => setConfig((c) => ({ ...c, [key]: value }));

  async function save(next: Record<string, unknown> = config) {
    setSaving(true); setError("");
    const ok = await onSave(next, notes);
    setSaving(false);
    if (!ok) { setError("No se pudo guardar. Intenta de nuevo."); return false; }
    onClose();
    return true;
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" style={{ backgroundColor: "oklch(0.18 0.015 258 / 0.35)" }} onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}>
      <aside role="dialog" aria-modal="true" aria-labelledby="feature-config-title" className="w-full max-w-[540px] h-full bg-card border-l border-border flex flex-col" style={{ boxShadow: "-20px 0 60px oklch(0.18 0.015 258 / 0.18)" }}>
        <header className="px-7 pt-7 pb-5 border-b border-border flex items-start gap-4">
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-semibold tracking-[0.12em] uppercase text-primary mb-1.5">Configuración</div>
            <h2 id="feature-config-title" className="text-[20px] font-semibold tracking-[-0.02em] leading-tight">{feature.name}</h2>
            {feature.description && <p className="text-[13px] text-muted-foreground mt-1.5">{feature.description}</p>}
            <div className="mt-3"><Pill tone={feature.featureType === "config" || feature.adminGranted ? "ok" : "mute"}>{feature.featureType === "config" ? "Siempre activa" : feature.adminGranted ? "Activa para el cliente" : "Apagada · los valores se guardan igual"}</Pill></div>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" disabled={saving} className="text-muted-foreground hover:text-foreground mt-1"><X className="w-4 h-4" /></button>
        </header>

        <div className="flex-1 overflow-y-auto px-7 py-6 flex flex-col gap-6">
          {isCustomForms ? (
            <CustomFormConfig
              initialConfig={config as unknown as CustomFormsConfig}
              subsidiaries={subsidiaries}
              disabled={saving}
              onSave={(next) => save(next as unknown as Record<string, unknown>)}
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {(feature.configSchema ?? []).map((p) => {
                const value = config[p.key];
                const isRate = p.type === "number" && p.min !== undefined && p.max !== undefined && p.max - p.min <= 1;
                return (
                  <Field key={p.key} label={p.label} hint={p.description} className={cn(p.type === "string" && "sm:col-span-2")}>
                    {p.type === "boolean" && (
                      <span className="flex items-center gap-3 py-1.5">
                        <Switch checked={Boolean(value ?? false)} onCheckedChange={(v) => set(p.key, Boolean(v))} aria-label={p.label} />
                        <span className="text-sm">{value ? "Activado" : "Desactivado"}</span>
                      </span>
                    )}
                    {p.type === "number" && isRate && (
                      <span className="flex items-center gap-3">
                        <input type="range" min={p.min} max={p.max} step={(p.max! - p.min!) / 100} value={Number(value ?? p.min)} onChange={(e) => set(p.key, parseFloat(e.target.value))} className="flex-1 accent-primary" aria-label={p.label} />
                        <TextInput type="number" min={p.min} max={p.max} step={(p.max! - p.min!) / 100} value={Number(value ?? p.min)} onChange={(e) => set(p.key, parseFloat(e.target.value))} className="w-24 tabular-nums" />
                      </span>
                    )}
                    {p.type === "number" && !isRate && (
                      <TextInput type="number" min={p.min} max={p.max} value={Number(value ?? 0)} onChange={(e) => set(p.key, Number(e.target.value))} className="tabular-nums" />
                    )}
                    {p.type === "string" && <TextInput value={String(value ?? "")} onChange={(e) => set(p.key, e.target.value)} />}
                    {p.type === "select" && p.options && (
                      <Select value={String(value ?? p.options[0])} onChange={(e) => set(p.key, e.target.value)}>
                        {p.options.map((o) => <option key={o} value={o}>{p.optionLabels?.[o] ?? o}</option>)}
                      </Select>
                    )}
                  </Field>
                );
              })}
              {(feature.configSchema ?? []).length === 0 && <p className="text-sm text-muted-foreground sm:col-span-2">Esta feature no tiene parámetros; solo se activa o apaga.</p>}
            </div>
          )}

          <Field label="Nota del administrador" optional hint="Por qué se activó, se apagó o se ajustó. Queda junto al cliente, no en la auditoría.">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={cn(control, "resize-none")} />
          </Field>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        {!isCustomForms && (
          <footer className="px-7 py-4 border-t border-border flex items-center justify-end gap-2 bg-background/60">
            <Button variant="ghost" onClick={onClose} disabled={saving}>Cancelar</Button>
            <Button onClick={() => save()} disabled={saving}>{saving && <Loader2 className="animate-spin" />}Guardar</Button>
          </footer>
        )}
      </aside>
    </div>
  );
}
