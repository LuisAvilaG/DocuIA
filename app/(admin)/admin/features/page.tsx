"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import {
  Cpu, Map as MapIcon, Workflow, RefreshCw, Plug, BarChart3,
  Shield, Building, HardDrive, Search, SlidersHorizontal,
  FlaskConical, Loader2, CheckCircle2, AlertTriangle,
} from "lucide-react";

const CATEGORIES = [
  { id: "all",         label: "Todos",          icon: SlidersHorizontal },
  { id: "extraction",  label: "Extracción AI",  icon: Cpu },
  { id: "mapping",     label: "Mapeo",          icon: MapIcon },
  { id: "workflow",    label: "Workflow",        icon: Workflow },
  { id: "sync",        label: "Sincronización", icon: RefreshCw },
  { id: "integration", label: "Integración",    icon: Plug },
  { id: "analytics",   label: "Analytics",      icon: BarChart3 },
  { id: "storage",     label: "Storage",        icon: HardDrive },
  { id: "security",    label: "Seguridad",      icon: Shield },
  { id: "enterprise",  label: "Enterprise",     icon: Building },
];

const PLAN_BADGE: Record<string, string> = {
  starter:    "bg-muted text-muted-foreground border-border",
  growth:     "bg-primary/10 text-primary border-primary/20",
  enterprise: "bg-violet-400/10 text-violet-400 border-violet-400/20",
};

type Feature = {
  id: string;
  name: string;
  description: string | null;
  category: string;
  featureType: string;
  defaultEnabled: boolean;
  planRequired: string;
  isBeta: boolean;
  sortOrder: number;
};

function FeatureRow({ feature }: { feature: Feature }) {
  const [enabled, setEnabled] = useState(feature.defaultEnabled);
  const [saving,  setSaving]  = useState(false);
  const [flash,   setFlash]   = useState<"saved" | null>(null);

  async function toggle() {
    const next = !enabled;
    setEnabled(next);
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/features/${feature.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultEnabled: next }),
      });
      if (!res.ok) {
        setEnabled(!next);
        return;
      }
      setFlash("saved");
      setTimeout(() => setFlash(null), 2000);
    } catch {
      setEnabled(!next);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={cn(
      "bg-card rounded-xl border p-4 flex items-start gap-3 transition-all",
      enabled ? "border-primary/30 shadow-sm shadow-primary/5" : "border-border hover:border-border/60"
    )}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span className="text-sm font-medium text-foreground">{feature.name}</span>
          {feature.isBeta && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-warning/10 text-warning border border-warning/20">
              <FlaskConical className="w-2.5 h-2.5" /> Beta
            </span>
          )}
          <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded border", PLAN_BADGE[feature.planRequired])}>
            {feature.planRequired}
          </span>
          <span className="text-[10px] text-muted-foreground/50 font-mono">{feature.id}</span>
        </div>
        {feature.description && (
          <p className="text-xs text-muted-foreground leading-relaxed">{feature.description}</p>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0 mt-0.5">
        {saving  && <Loader2    className="w-3 h-3 text-muted-foreground animate-spin" />}
        {flash === "saved" && <CheckCircle2 className="w-3 h-3 text-success" />}
        <button
          onClick={toggle}
          disabled={saving}
          className={cn(
            "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent",
            "transition-colors duration-200 focus:outline-none disabled:opacity-50",
            enabled ? "bg-primary" : "bg-secondary"
          )}
        >
          <span className={cn(
            "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm",
            "transform transition-transform duration-200",
            enabled ? "translate-x-4" : "translate-x-0"
          )} />
        </button>
      </div>
    </div>
  );
}

export default function FeaturesPage() {
  const [features,  setFeatures]  = useState<Feature[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState("");
  const [category,  setCategory]  = useState("all");
  const [search,    setSearch]    = useState("");

  useEffect(() => {
    fetch("/api/admin/features")
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) setFeatures(data);
        else setError(data.error ?? "Error al cargar features");
      })
      .catch(() => setError("No se pudo conectar"))
      .finally(() => setLoading(false));
  }, []);

  function isHidden(f: Feature) {
    if (category !== "all" && f.category !== category) return true;
    if (search && !f.name.toLowerCase().includes(search.toLowerCase()) &&
        !(f.description ?? "").toLowerCase().includes(search.toLowerCase())) return true;
    return false;
  }
  const visibleCount = features.filter(f => !isHidden(f)).length;

  return (
    <div className="flex-1 flex flex-col">
      <div className="h-14 border-b border-border px-6 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-sm font-semibold text-foreground">Catálogo de Features</h1>
          <p className="text-xs text-muted-foreground">
            Defaults globales — overrides por cliente en{" "}
            <span className="text-primary">Clientes → &lt;org&gt; → Features</span>
          </p>
        </div>
        {!loading && !error && (
          <span className="text-xs text-muted-foreground">{features.length} features</span>
        )}
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar categorías */}
        <div className="w-44 border-r border-border bg-card/50 p-2 space-y-0.5 shrink-0 overflow-y-auto">
          {CATEGORIES.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setCategory(id)}
              className={cn(
                "w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium transition-all text-left",
                category === id
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              )}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              {label}
            </button>
          ))}
        </div>

        {/* Contenido */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="relative mb-5 max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Buscar feature..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-card border border-border/60 rounded-lg pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60"
            />
          </div>

          {loading && (
            <div className="flex items-center justify-center py-20 gap-2 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Cargando features...</span>
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
              <AlertTriangle className="w-8 h-8 text-warning" />
              <p className="text-sm text-foreground">{error}</p>
              <p className="text-xs text-muted-foreground">
                Asegúrate de haber corrido{" "}
                <code className="text-primary bg-primary/10 px-1 py-0.5 rounded">npm run seed:features</code>
              </p>
            </div>
          )}

          {!loading && !error && visibleCount === 0 && (
            <div className="text-center py-20 text-muted-foreground">
              <p className="text-sm">Sin resultados para "{search}"</p>
            </div>
          )}

          {/* Todos los FeatureRow siempre montados — display:none para ocultar los que no coinciden.
              Evita que React desmonte/remonte y pierda el estado local del toggle al filtrar. */}
          {!loading && !error && features.length > 0 && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
              {features.map(f => (
                <div key={f.id} style={isHidden(f) ? { display: "none" } : undefined}>
                  <FeatureRow feature={f} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
