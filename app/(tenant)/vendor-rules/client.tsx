"use client";

import { useMemo, useRef, useState } from "react";
import { Plus, Loader2, Trash2, X, Search, ListChecks } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { VendorRuleConfig } from "@/lib/workflow/vendor-rules";
import type { VendorCategory, VendorRuleScope, VendorRuleView } from "@/lib/workflow/vendor-rules-store";

interface Props {
  initialRules: VendorRuleView[];
  categories: VendorCategory[];
  canManage: boolean;
  maxRules: number;
  orgThresholdPct: number;
  features: { poMatching: boolean; threeWay: boolean; sat: boolean };
}

type Editor = {
  id: string | null;
  scope: VendorRuleScope;
  targetKey: string;
  targetLabel: string;
  config: VendorRuleConfig;
};

type VendorOption = { internalId: string; name: string; entityid: string };

const EMPTY_CONFIG: VendorRuleConfig = {
  poRequirement: "optional",
  requireReceipt: false,
  totalTolerancePct: null,
  priceTolerancePct: null,
  onMismatch: null,
  satRequired: true,
  autoProcessPct: null,
  neverAutoProcess: false,
};

const PO_LABEL: Record<VendorRuleConfig["poRequirement"], string> = { required: "Obligatoria", optional: "Opcional", none: "Sin OC" };
const MISMATCH_LABEL: Record<string, string> = { approval: "Enviar a aprobación", block: "Bloquear", warn: "Solo avisar" };

const inputCls = "w-full h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none transition-all duration-[120ms] focus:border-primary focus:shadow-[0_0_0_3px_oklch(0.48_0.15_182_/_0.12)] disabled:opacity-60";
const labelCls = "text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-foreground";

function Pill({ tone, children }: { tone: "grey" | "ok" | "err" | "warn"; children: React.ReactNode }) {
  return (
    <span className={cn(
      "inline-flex items-center rounded-sm px-2 py-0.5 text-[0.6875rem] font-medium whitespace-nowrap",
      tone === "grey" && "bg-secondary text-muted-foreground",
      tone === "ok" && "bg-success/10 text-success",
      tone === "err" && "bg-destructive/10 text-destructive",
      tone === "warn" && "bg-warning/10 text-warning",
    )}>{children}</span>
  );
}

function pctInput(value: string): number | null {
  if (!value.trim()) return null;
  const n = Number(value.replace(",", "."));
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : null;
}

function ruleTitle(rule: Pick<VendorRuleView, "scope" | "targetLabel" | "targetKey">): string {
  if (rule.scope === "default") return "Predeterminada";
  return `${rule.scope === "category" ? "Categoría" : "Proveedor"}: ${rule.targetLabel ?? rule.targetKey}`;
}

export function VendorRulesClient({ initialRules, categories, canManage, maxRules, orgThresholdPct, features }: Props) {
  const [rules, setRules] = useState(initialRules);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [vendorQuery, setVendorQuery] = useState("");
  const [vendorOptions, setVendorOptions] = useState<VendorOption[]>([]);
  const [searching, setSearching] = useState(false);
  const searchSeq = useRef(0);

  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const hasDefault = rules.some((r) => r.scope === "default");
  const atLimit = rules.length >= maxRules;

  function subtitle(rule: VendorRuleView): string {
    if (rule.scope === "default") return "Todos los demás proveedores";
    if (rule.scope === "category") {
      const n = categoryById.get(rule.targetKey)?.vendorCount;
      return n != null ? `${n} proveedor${n === 1 ? "" : "es"}` : "Categoría del ERP";
    }
    return "Sobrescribe su categoría";
  }

  function tolerance(c: VendorRuleConfig): string {
    if (c.poRequirement === "none") return "—";
    const parts = [
      c.totalTolerancePct != null ? `Total ${c.totalTolerancePct}%` : null,
      c.priceTolerancePct != null ? `precio ${c.priceTolerancePct}%` : null,
    ].filter(Boolean);
    return parts.length ? parts.join(" · ") : "General";
  }

  function openNew() {
    setEditor({ id: null, scope: hasDefault ? "category" : "default", targetKey: "", targetLabel: "", config: { ...EMPTY_CONFIG } });
    setError(null);
    setConfirmDelete(false);
    setVendorQuery("");
    setVendorOptions([]);
  }

  function openEdit(rule: VendorRuleView) {
    if (!canManage) return;
    setEditor({ id: rule.id, scope: rule.scope, targetKey: rule.targetKey, targetLabel: rule.targetLabel ?? "", config: { ...rule.config } });
    setError(null);
    setConfirmDelete(false);
  }

  function setConfig(patch: Partial<VendorRuleConfig>) {
    setEditor((e) => e ? { ...e, config: { ...e.config, ...patch } } : e);
  }

  async function searchVendors(q: string) {
    setVendorQuery(q);
    if (q.trim().length < 2) { setVendorOptions([]); return; }
    const seq = ++searchSeq.current;
    setSearching(true);
    try {
      const res = await fetch(`/api/v1/catalog/vendors?q=${encodeURIComponent(q.trim())}`);
      const data = await res.json() as { vendors?: VendorOption[] };
      if (seq !== searchSeq.current) return;
      const seen = new Set<string>();
      setVendorOptions((data.vendors ?? []).filter((v) => !seen.has(v.internalId) && seen.add(v.internalId)));
    } catch {
      if (seq === searchSeq.current) setVendorOptions([]);
    } finally {
      if (seq === searchSeq.current) setSearching(false);
    }
  }

  async function save() {
    if (!editor) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(editor.id ? `/api/v1/vendor-rules/${editor.id}` : "/api/v1/vendor-rules", {
        method: editor.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editor.id
          ? { config: editor.config }
          : { scope: editor.scope, targetKey: editor.targetKey, targetLabel: editor.targetLabel, config: editor.config }),
      });
      const data = await res.json() as { rule?: VendorRuleView; error?: string };
      if (!res.ok || !data.rule) { setError(data.error ?? "No se pudo guardar la regla"); return; }
      const saved = data.rule;
      setRules((current) => editor.id ? current.map((r) => r.id === saved.id ? saved : r) : [...current, saved]);
      setEditor(null);
    } catch {
      setError("No se pudo conectar con el servidor");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!editor?.id) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/vendor-rules/${editor.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        setError(data.error ?? "No se pudo eliminar la regla");
        return;
      }
      setRules((current) => current.filter((r) => r.id !== editor.id));
      setEditor(null);
    } catch {
      setError("No se pudo conectar con el servidor");
    } finally {
      setSaving(false);
    }
  }

  const sorted = useMemo(() => {
    const rank: Record<VendorRuleScope, number> = { default: 0, category: 1, vendor: 2 };
    return [...rules].sort((a, b) => rank[a.scope] - rank[b.scope] || ruleTitle(a).localeCompare(ruleTitle(b), "es"));
  }, [rules]);

  const takenCategories = new Set(rules.filter((r) => r.scope === "category").map((r) => r.targetKey));
  const canSubmit = editor && (editor.id || editor.scope === "default" || editor.targetKey);
  const c = editor?.config;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="h-14 border-b border-border px-6 flex items-center gap-3 shrink-0">
        <h1 className="text-sm font-semibold tracking-[-0.01em] text-foreground">Reglas de proveedores</h1>
        <span className="text-xs text-muted-foreground hidden sm:inline">Cómo se procesa cada factura según el proveedor</span>
        {canManage && (
          <button
            onClick={openNew}
            disabled={atLimit}
            title={atLimit ? `Tu plan permite hasta ${maxRules} reglas` : undefined}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" />Nueva regla
          </button>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        <div className="p-6 flex flex-col lg:flex-row gap-5 items-start">
          <div className="flex-1 min-w-0 w-full flex flex-col gap-3.5">
            <div className="bg-card border border-border rounded-xl px-4 py-3.5 flex flex-wrap items-center gap-3">
              <span className="rounded-sm bg-primary/10 px-2 py-0.5 text-[0.6875rem] font-semibold text-primary">Orden de prioridad</span>
              <span className="text-[0.8125rem] text-foreground">Proveedor específico → Categoría del proveedor en el ERP → Regla predeterminada. Se aplica la más específica.</span>
            </div>

            {!features.poMatching && (
              <p className="rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">
                La conciliación con órdenes de compra no está activa: las opciones de OC, recepción y tolerancias se guardan pero no se aplican hasta activarla.
              </p>
            )}

            <div className="bg-card border border-border rounded-xl overflow-hidden">
              {sorted.length === 0 ? (
                <div className="py-16 flex flex-col items-center text-center px-6">
                  <ListChecks className="w-8 h-8 text-muted-foreground/30 mb-3" />
                  <p className="text-sm font-medium text-foreground">Sin reglas todavía</p>
                  <p className="text-xs text-muted-foreground mt-1 max-w-sm">Mientras no haya reglas se usa la configuración general de la organización. Empieza con la regla predeterminada.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[0.8125rem]">
                    <thead className="bg-secondary/60 border-b border-border">
                      <tr>{["Aplica a", "Orden de compra", "Recepción", "Tolerancia", "Validación SAT", "Envío automático"].map((h) => (
                        <th key={h} className="px-3 py-2.5 text-left text-[0.65625rem] font-semibold uppercase tracking-[0.05em] text-muted-foreground whitespace-nowrap">{h}</th>
                      ))}</tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {sorted.map((rule) => (
                        <tr
                          key={rule.id}
                          onClick={() => openEdit(rule)}
                          className={cn("transition-colors duration-[120ms]", canManage && "cursor-pointer hover:bg-accent/40", editor?.id === rule.id && "bg-primary/5")}
                        >
                          <td className="px-3 py-3"><p className="font-semibold text-foreground">{ruleTitle(rule)}</p><p className="text-xs text-muted-foreground">{subtitle(rule)}</p></td>
                          <td className="px-3 py-3"><Pill tone={rule.config.poRequirement === "required" ? "err" : "grey"}>{PO_LABEL[rule.config.poRequirement]}</Pill></td>
                          <td className="px-3 py-3"><Pill tone={rule.config.requireReceipt ? "err" : "grey"}>{rule.config.requireReceipt ? "Obligatoria" : "No"}</Pill></td>
                          <td className="px-3 py-3 text-foreground whitespace-nowrap">{tolerance(rule.config)}</td>
                          <td className="px-3 py-3"><Pill tone={rule.config.satRequired ? "ok" : "grey"}>{rule.config.satRequired ? "Sí" : "No"}</Pill></td>
                          <td className="px-3 py-3 whitespace-nowrap">
                            {rule.config.neverAutoProcess
                              ? <Pill tone="warn">Siempre revisión</Pill>
                              : <span className="text-foreground">Confianza ≥ {rule.config.autoProcessPct ?? orgThresholdPct}%</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Las categorías vienen del campo de categoría del proveedor en el ERP y se actualizan con la sincronización de catálogos.
              {" "}{rules.length} de {maxRules} reglas.
            </p>
          </div>

          {editor && c && (
            <div className="w-full lg:w-[380px] shrink-0 bg-card border border-border rounded-xl p-5 flex flex-col gap-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <span className={labelCls}>{editor.id ? "Editar regla" : "Nueva regla"}</span>
                  <h2 className="mt-1 text-sm font-semibold text-foreground">
                    {editor.id ? ruleTitle({ scope: editor.scope, targetKey: editor.targetKey, targetLabel: editor.targetLabel || null }) : "¿A qué aplica?"}
                  </h2>
                </div>
                <button type="button" onClick={() => setEditor(null)} className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label="Cerrar"><X className="w-4 h-4" /></button>
              </div>

              {!editor.id && (
                <>
                  <div className="flex flex-col gap-1.5">
                    <label className={labelCls} htmlFor="vr-scope">Aplica a</label>
                    <select id="vr-scope" className={inputCls} value={editor.scope} onChange={(e) => setEditor({ ...editor, scope: e.target.value as VendorRuleScope, targetKey: "", targetLabel: "" })}>
                      {!hasDefault && <option value="default">Predeterminada (todos los proveedores)</option>}
                      <option value="category">Una categoría de proveedores</option>
                      <option value="vendor">Un proveedor específico</option>
                    </select>
                  </div>
                  {editor.scope === "category" && (
                    <div className="flex flex-col gap-1.5">
                      <label className={labelCls} htmlFor="vr-cat">Categoría</label>
                      {categories.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No hay categorías en el catálogo. Sincroniza los proveedores desde Catálogos después de asignarles categoría en el ERP.</p>
                      ) : (
                        <select id="vr-cat" className={inputCls} value={editor.targetKey} onChange={(e) => setEditor({ ...editor, targetKey: e.target.value, targetLabel: categoryById.get(e.target.value)?.name ?? "" })}>
                          <option value="">Selecciona una categoría</option>
                          {categories.map((cat) => (
                            <option key={cat.id} value={cat.id} disabled={takenCategories.has(cat.id)}>
                              {cat.name} ({cat.vendorCount}){takenCategories.has(cat.id) ? " · ya tiene regla" : ""}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}
                  {editor.scope === "vendor" && (
                    <div className="relative flex flex-col gap-1.5">
                      <label className={labelCls} htmlFor="vr-vendor">Proveedor</label>
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                        <input id="vr-vendor" className={cn(inputCls, "pl-9")} value={editor.targetKey ? editor.targetLabel : vendorQuery} placeholder="Nombre o ID del proveedor" onChange={(e) => { setEditor({ ...editor, targetKey: "", targetLabel: "" }); searchVendors(e.target.value); }} />
                        {searching && <Loader2 className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />}
                      </div>
                      {!editor.targetKey && vendorOptions.length > 0 && (
                        <div className="absolute top-full z-20 mt-1 max-h-52 w-full overflow-auto rounded-md border border-border bg-card py-1 shadow-md">
                          {vendorOptions.map((v) => (
                            <button type="button" key={v.internalId} onClick={() => { setEditor({ ...editor, targetKey: v.internalId, targetLabel: v.name || v.entityid }); setVendorOptions([]); }} className="block w-full px-3 py-2 text-left text-xs hover:bg-secondary">
                              <span className="block font-medium text-foreground">{v.name || v.entityid}</span>
                              <span className="text-muted-foreground">#{v.internalId}{v.entityid ? ` · ${v.entityid}` : ""}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  <div className="border-t border-border" />
                </>
              )}

              <div className="flex flex-col gap-1.5">
                <label className={labelCls} htmlFor="vr-po">Orden de compra</label>
                <select id="vr-po" className={inputCls} value={c.poRequirement} onChange={(e) => setConfig({ poRequirement: e.target.value as VendorRuleConfig["poRequirement"], ...(e.target.value === "none" ? { requireReceipt: false } : {}) })}>
                  <option value="required">Obligatoria</option>
                  <option value="optional">Opcional</option>
                  <option value="none">Sin OC</option>
                </select>
              </div>

              {c.poRequirement !== "none" && (
                <>
                  <label className="flex items-center justify-between gap-3 text-[0.8125rem] text-foreground">
                    <span>Exigir entrada de almacén (3 vías){!features.threeWay && <span className="block text-[0.6875rem] text-muted-foreground">Requiere activar la validación con recepción</span>}</span>
                    <Switch checked={c.requireReceipt} onCheckedChange={(v) => setConfig({ requireReceipt: v })} aria-label="Exigir entrada de almacén" />
                  </label>
                  <div className="flex gap-3">
                    <div className="flex-1 flex flex-col gap-1.5">
                      <label className={labelCls} htmlFor="vr-tt">Tolerancia total %</label>
                      <input id="vr-tt" inputMode="decimal" className={inputCls} placeholder="General" value={c.totalTolerancePct ?? ""} onChange={(e) => setConfig({ totalTolerancePct: pctInput(e.target.value) })} />
                    </div>
                    <div className="flex-1 flex flex-col gap-1.5">
                      <label className={labelCls} htmlFor="vr-tp">Tolerancia precio %</label>
                      <input id="vr-tp" inputMode="decimal" className={inputCls} placeholder="General" value={c.priceTolerancePct ?? ""} onChange={(e) => setConfig({ priceTolerancePct: pctInput(e.target.value) })} />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className={labelCls} htmlFor="vr-mm">Si no cuadra</label>
                    <select id="vr-mm" className={inputCls} value={c.onMismatch ?? ""} onChange={(e) => setConfig({ onMismatch: (e.target.value || null) as VendorRuleConfig["onMismatch"] })}>
                      <option value="">Según configuración general</option>
                      {Object.entries(MISMATCH_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                </>
              )}

              <label className="flex items-center justify-between gap-3 text-[0.8125rem] text-foreground">
                <span>Validación SAT obligatoria{!features.sat && <span className="block text-[0.6875rem] text-muted-foreground">Requiere activar la validación fiscal del CFDI</span>}</span>
                <Switch checked={c.satRequired} onCheckedChange={(v) => setConfig({ satRequired: v })} aria-label="Validación SAT obligatoria" />
              </label>

              <label className="flex items-center justify-between gap-3 text-[0.8125rem] text-foreground">
                <span>Siempre enviar a revisión</span>
                <Switch checked={c.neverAutoProcess} onCheckedChange={(v) => setConfig({ neverAutoProcess: v })} aria-label="Siempre enviar a revisión" />
              </label>

              {!c.neverAutoProcess && (
                <div className="flex flex-col gap-1.5">
                  <label className={labelCls} htmlFor="vr-au">Envío automático con confianza ≥ %</label>
                  <input id="vr-au" inputMode="decimal" className={inputCls} placeholder={`${orgThresholdPct} (general)`} value={c.autoProcessPct ?? ""} onChange={(e) => setConfig({ autoProcessPct: pctInput(e.target.value) })} />
                </div>
              )}

              {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}

              <div className="flex gap-2.5 pt-1">
                <button type="button" onClick={() => setEditor(null)} disabled={saving} className="flex-1 h-10 rounded-lg border border-border bg-card text-[0.8125rem] font-semibold text-foreground hover:bg-secondary disabled:opacity-60">Cancelar</button>
                <button type="button" onClick={save} disabled={saving || !canSubmit} className="flex-1 h-10 inline-flex items-center justify-center gap-2 rounded-lg bg-primary text-[0.8125rem] font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                  {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}Guardar regla
                </button>
              </div>

              {editor.id && (
                confirmDelete ? (
                  <div className="flex items-center justify-between gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs">
                    <span className="text-destructive">¿Eliminar esta regla?</span>
                    <span className="flex gap-3">
                      <button type="button" onClick={remove} disabled={saving} className="font-semibold text-destructive hover:underline">Eliminar</button>
                      <button type="button" onClick={() => setConfirmDelete(false)} className="text-muted-foreground hover:text-foreground">Cancelar</button>
                    </span>
                  </div>
                ) : (
                  <button type="button" onClick={() => setConfirmDelete(true)} className="self-start inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive">
                    <Trash2 className="w-3.5 h-3.5" />Eliminar regla
                  </button>
                )
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
