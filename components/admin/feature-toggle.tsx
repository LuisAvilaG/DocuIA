"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ChevronDown, FlaskConical, Loader2 } from "lucide-react";

interface ConfigParam {
  key: string;
  label: string;
  type: "boolean" | "number" | "string" | "select";
  min?: number;
  max?: number;
  options?: string[];
  description?: string;
}

interface Feature {
  id: string;
  name: string;
  description: string | null;
  category: string;
  featureType: "boolean" | "config" | "boolean_config";
  defaultConfig: Record<string, unknown> | null;
  configSchema: ConfigParam[] | null;
  planRequired: "starter" | "growth" | "enterprise";
  isBeta: boolean;
  adminGranted: boolean;
  tenantEnabled: boolean;
  isEnabled: boolean;
  config: Record<string, unknown>;
  notes: string | null;
  enabledBy: string | null;
}

const PLAN_BADGE: Record<string, string> = {
  starter:    "bg-muted text-muted-foreground border-border",
  growth:     "bg-primary/10 text-primary border-primary/20",
  enterprise: "bg-violet-400/10 text-violet-400 border-violet-400/20",
};

interface FeatureToggleProps {
  feature: Feature;
  orgId: string;
  onEnabledChange?: (featureId: string, enabled: boolean) => void;
}

export function FeatureToggle({ feature, orgId, onEnabledChange }: FeatureToggleProps) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(feature.adminGranted);
  const [config, setConfig] = useState<Record<string, unknown>>(feature.config ?? {});
  const [notes, setNotes] = useState(feature.notes ?? "");
  const [expanded, setExpanded] = useState(feature.adminGranted && feature.featureType !== "boolean");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState(false);

  const hasConfig = feature.featureType !== "boolean" && feature.configSchema && feature.configSchema.length > 0;

  async function save(nextEnabled: boolean, nextConfig: Record<string, unknown>, nextNotes: string) {
    setSaving(true);
    setSaved(false);
    setSaveError(false);
    try {
      const res = await fetch(`/api/admin/clients/${orgId}/features/${feature.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminGranted: nextEnabled, config: nextConfig, notes: nextNotes }),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
        router.refresh(); // re-sincroniza server data con UI
      } else {
        setSaveError(true);
        setTimeout(() => setSaveError(false), 3000);
        setEnabled(!nextEnabled);
        onEnabledChange?.(feature.id, !nextEnabled); // revert parent map
      }
    } catch {
      setSaveError(true);
      setTimeout(() => setSaveError(false), 3000);
      setEnabled(!nextEnabled);
      onEnabledChange?.(feature.id, !nextEnabled); // revert parent map
    } finally {
      setSaving(false);
    }
  }

  function handleToggle(val: boolean) {
    setEnabled(val);
    onEnabledChange?.(feature.id, val); // update parent map immediately (optimistic)
    if (val && hasConfig) setExpanded(true);
    save(val, config, notes);
  }

  function handleConfigChange(key: string, value: unknown) {
    const next = { ...config, [key]: value };
    setConfig(next);
  }

  function handleConfigBlur() {
    save(enabled, config, notes);
  }

  function handleNotesBlur() {
    save(enabled, config, notes);
  }

  const showConfig = hasConfig && (feature.featureType === "config" || enabled);

  return (
    <div className={cn(
      "bg-card rounded-xl border transition-all duration-200",
      enabled
        ? "border-primary/30 shadow-sm shadow-primary/5"
        : "border-border hover:border-border/80"
    )}>
      {/* Header */}
      <div className="p-4">
        <div className="flex items-start gap-3">
          {/* Left: info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="text-sm font-medium text-foreground">{feature.name}</span>
              {feature.isBeta && (
                <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-warning/10 text-warning border border-warning/20">
                  <FlaskConical className="w-2.5 h-2.5" />
                  Beta
                </span>
              )}
              <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded border", PLAN_BADGE[feature.planRequired])}>
                {feature.planRequired}
              </span>
              {feature.id === "netsuite_dry_run" && (
                <span className={cn(
                  "text-[10px] font-medium px-1.5 py-0.5 rounded border",
                  feature.tenantEnabled
                    ? "bg-success/10 text-success border-success/20"
                    : "bg-secondary text-muted-foreground border-border"
                )}>
                  Tenant: {feature.tenantEnabled ? "Activo" : "Inactivo"}
                </span>
              )}
            </div>
            {feature.description && (
              <p className="text-xs text-muted-foreground leading-relaxed">{feature.description}</p>
            )}
          </div>

          {/* Right: toggle + expand */}
          <div className="flex items-center gap-2 shrink-0">
            {saving && <Loader2 className="w-3 h-3 text-muted-foreground animate-spin" />}
            {saved && <span className="text-[10px] text-success">Guardado</span>}
            {saveError && <span className="text-[10px] text-destructive">Error al guardar</span>}
            {feature.featureType !== "config" && (
              <Switch
                checked={enabled}
                onCheckedChange={handleToggle}
                className={cn(
                  "data-[state=checked]:bg-primary data-[state=unchecked]:bg-secondary",
                  "h-5 w-9"
                )}
              />
            )}
            {hasConfig && (
              <button
                onClick={() => setExpanded(!expanded)}
                className="text-muted-foreground hover:text-foreground transition-colors p-0.5"
              >
                <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", expanded && "rotate-180")} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Config panel */}
      {showConfig && expanded && feature.configSchema && (
        <div className="border-t border-border/60 px-4 pb-4 pt-3 space-y-3">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
            Configuración
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {feature.configSchema.map((param) => (
              <div key={param.key} className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground block">
                  {param.label}
                </label>

                {param.type === "boolean" && (
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={Boolean(config[param.key] ?? false)}
                      onCheckedChange={(val) => { handleConfigChange(param.key, val); setTimeout(handleConfigBlur, 100); }}
                      className="data-[state=checked]:bg-primary data-[state=unchecked]:bg-secondary h-4 w-7"
                    />
                    <span className="text-xs text-muted-foreground">
                      {config[param.key] ? "Activado" : "Desactivado"}
                    </span>
                  </div>
                )}

                {param.type === "number" && (
                  <div className="flex items-center gap-2">
                    {param.min !== undefined && param.max !== undefined && (param.max - param.min) <= 1 ? (
                      <div className="flex items-center gap-2 flex-1">
                        <input
                          type="range"
                          min={param.min}
                          max={param.max}
                          step={(param.max - param.min) / 100}
                          value={Number(config[param.key] ?? param.min)}
                          onChange={(e) => handleConfigChange(param.key, parseFloat(e.target.value))}
                          onMouseUp={handleConfigBlur}
                          className="flex-1 accent-primary h-1.5"
                        />
                        <Input
                          type="number"
                          min={param.min}
                          max={param.max}
                          step={(param.max - param.min) / 100}
                          value={Number(config[param.key] ?? param.min)}
                          onChange={(e) => handleConfigChange(param.key, parseFloat(e.target.value))}
                          onBlur={handleConfigBlur}
                          className="w-16 h-6 text-xs bg-secondary/50 border-border/60 px-2"
                        />
                      </div>
                    ) : (
                      <Input
                        type="number"
                        min={param.min}
                        max={param.max}
                        value={Number(config[param.key] ?? 0)}
                        onChange={(e) => handleConfigChange(param.key, Number(e.target.value))}
                        onBlur={handleConfigBlur}
                        className="w-28 h-6 text-xs bg-secondary/50 border-border/60 px-2"
                      />
                    )}
                    {param.description && (
                      <span className="text-[10px] text-muted-foreground/60 max-w-[120px] leading-tight">
                        {param.description}
                      </span>
                    )}
                  </div>
                )}

                {param.type === "string" && (
                  <Input
                    value={String(config[param.key] ?? "")}
                    onChange={(e) => handleConfigChange(param.key, e.target.value)}
                    onBlur={handleConfigBlur}
                    placeholder={param.description}
                    className="h-7 text-xs bg-secondary/50 border-border/60"
                  />
                )}

                {param.type === "select" && param.options && (
                  <select
                    value={String(config[param.key] ?? param.options[0])}
                    onChange={(e) => { handleConfigChange(param.key, e.target.value); setTimeout(handleConfigBlur, 100); }}
                    className="w-full bg-secondary/50 border border-border/60 rounded-md px-2 py-1 text-xs text-foreground focus:outline-none focus:border-primary/60"
                  >
                    {param.options.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                )}
              </div>
            ))}
          </div>

          {/* Notes */}
          <div className="pt-1">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">
              Nota del administrador
            </label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={handleNotesBlur}
              placeholder="¿Por qué se habilitó/deshabilitó? (opcional)"
              rows={2}
              className="text-xs bg-secondary/50 border-border/60 resize-none placeholder:text-muted-foreground/40"
            />
          </div>
        </div>
      )}
    </div>
  );
}
