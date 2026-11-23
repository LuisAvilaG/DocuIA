"use client";

import { useMemo, useRef, useState } from "react";
import { Plus, Loader2, Trash2, Search } from "lucide-react";
import { btn, Drawer, EmptyState, Notice, PageFrame } from "@/components/kit";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { VendorRuleConfig } from "@/lib/workflow/vendor-rules";
import type { RuleUsage, VendorCategory, VendorRuleScope, VendorRuleView } from "@/lib/workflow/vendor-rules-store";
import { RuleFinder } from "./rule-finder";

interface Props {
  initialRules: VendorRuleView[];
  categories: VendorCategory[];
  canManage: boolean;
  maxRules: number;
  orgThresholdPct: number;
  features: { poMatching: boolean; threeWay: boolean; sat: boolean };
  /** Proveedores y facturas del trimestre por regla. */
  usage: Record<string, RuleUsage>;
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

const inputCls = "w-full min-h-10 rounded-lg border border-[#D6D2C8] bg-white px-3 text-sm text-foreground outline-none transition-all duration-[120ms] focus:border-primary focus:shadow-[0_0_0_3px_oklch(0.48_0.15_182_/_0.12)] disabled:opacity-60";
const labelCls = "text-[13px] font-semibold text-foreground/90";

function pctInput(value: string): number | null {
  if (!value.trim()) return null;
  const n = Number(value.replace(",", "."));
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : null;
}

// Keeps what is typed ("0." on the way to "0.5"); turning every keystroke
// into a number dropped the decimal point and saved 5 instead of 0.5.
function PctInput({ value, onChange, placeholder }: { value: number | null; onChange: (value: number | null) => void; placeholder: string }) {
  const shown = value === null ? "" : String(value);
  const [text, setText] = useState(shown);
  // Another rule was opened, or the value was changed elsewhere (adjusted during render).
  if (pctInput(text) !== value) setText(shown);
  return (
    <input inputMode="decimal" className={inputCls} placeholder={placeholder} value={text}
      onChange={(e) => { setText(e.target.value); onChange(pctInput(e.target.value)); }}
      onBlur={() => setText(shown)} />
  );
}

function ruleTitle(rule: Pick<VendorRuleView, "scope" | "targetLabel" | "targetKey">): string {
  if (rule.scope === "default") return "Predeterminada";
  return `${rule.scope === "category" ? "Categoría" : "Proveedor"}: ${rule.targetLabel ?? rule.targetKey}`;
}

export function VendorRulesClient({ initialRules, categories, canManage, maxRules, orgThresholdPct, features, usage }: Props) {
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
    const u = usage[rule.id];
    const inv = u ? `${u.invoices.toLocaleString("es-MX")} factura${u.invoices === 1 ? "" : "s"} este trimestre` : null;
    const ven = (n: number) => `${n.toLocaleString("es-MX")} proveedor${n === 1 ? "" : "es"}`;
    if (rule.scope === "default") return [u ? `${ven(u.vendors)} sin regla propia` : "Todos los demás proveedores", inv].filter(Boolean).join(" · ");
    if (rule.scope === "category") {
      const n = u?.vendors ?? categoryById.get(rule.targetKey)?.vendorCount;
      return ["Categoría", n != null ? ven(n) : null, inv].filter(Boolean).join(" · ");
    }
    return ["Proveedor", inv].filter(Boolean).join(" · ");
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

  const defaultRule = rules.find((r) => r.scope === "default") ?? null;
  const steps = (cfg: VendorRuleConfig) => {
    const noPo = cfg.poRequirement === "none";
    return [
      { k: "po", label: "Orden de compra", value: PO_LABEL[cfg.poRequirement] },
      { k: "rx", label: "Recepción", value: noPo ? "No aplica" : cfg.requireReceipt ? "Exige entrada" : "No" },
      { k: "tol", label: "Tolerancia", value: noPo ? "No aplica" : tolerance(cfg) },
      { k: "mm", label: "Si no cuadra", value: noPo ? "No aplica" : cfg.onMismatch ? MISMATCH_LABEL[cfg.onMismatch] : "General" },
      { k: "auto", label: "Envío solo", value: cfg.neverAutoProcess ? "Nunca · siempre revisión" : `Con ${cfg.autoProcessPct ?? orgThresholdPct} %${cfg.satRequired ? " · SAT" : ""}` },
    ];
  };
  const baseSteps = defaultRule ? steps(defaultRule.config) : null;
  const groups: Array<{ n: number; title: string; scope: VendorRuleScope }> = [
    { n: 1, title: "Proveedores específicos", scope: "vendor" },
    { n: 2, title: "Por categoría del proveedor en el ERP", scope: "category" },
    { n: 3, title: "Para todos los demás", scope: "default" },
  ];

  return (
    <PageFrame>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.06em] text-link">Configuración</p>
          <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-[-0.025em]">Reglas de proveedores</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">Qué camino sigue la factura de cada proveedor antes de llegar al ERP. Se aplica la más específica{baseSteps ? "; en verde, lo que cambia frente a la predeterminada" : ""}.</p>
        </div>
        {canManage && (
          <button type="button" onClick={openNew} disabled={atLimit} title={atLimit ? `Tu plan permite hasta ${maxRules} reglas` : undefined} className={btn("primary")}>
            <Plus />Nueva regla
          </button>
        )}
      </div>

      {!features.poMatching && (
        <Notice className="mt-5" tone="warn" title="La relación con órdenes de compra no está activa">Las opciones de OC, recepción y tolerancias se guardan, pero no se aplican hasta activarla.</Notice>
      )}

      {sorted.length > 0 && <RuleFinder />}

      {sorted.length === 0 ? (
        <EmptyState className="mt-6" title="Sin reglas todavía"
          actions={canManage ? <button type="button" onClick={openNew} className={btn("primary")}><Plus />Crear la regla predeterminada</button> : undefined}>
          Mientras no haya reglas se usa la configuración general. Empieza con la predeterminada.
        </EmptyState>
      ) : groups.map((g) => {
        const list = sorted.filter((r) => r.scope === g.scope);
        if (list.length === 0) return null;
        return (
          <section key={g.scope} className="mt-6.5">
            <h2 className="mb-2.5 flex items-center gap-2.5 text-xs font-semibold uppercase tracking-[0.06em] text-foreground/75">
              <b aria-hidden className="inline-flex size-5 items-center justify-center rounded-full bg-foreground text-[11px] text-background">{g.n}</b>{g.title}
            </h2>
            <div className="flex flex-col gap-2.5">
              {list.map((rule) => {
                const isDefault = rule.scope === "default";
                const st = steps(rule.config);
                const Wrapper = canManage ? "button" : "div";
                return (
                  <Wrapper key={rule.id} {...(canManage ? { type: "button" as const, onClick: () => openEdit(rule) } : {})}
                    className={cn("grid w-full items-center gap-4.5 rounded-[14px] border px-4.5 py-4 text-left lg:grid-cols-[220px_minmax(0,1fr)_auto]",
                      isDefault ? "border-dashed border-border bg-background" : "border-border bg-card",
                      canManage && "hover:border-[#9FCFC8]", editor?.id === rule.id && "border-primary")}>
                    <span className="min-w-0">
                      <b className="block truncate text-[15px] font-semibold">{isDefault ? "Predeterminada" : ruleTitle(rule)}</b>
                      <span className="text-[12.5px] text-muted-foreground">{subtitle(rule)}</span>
                    </span>
                    <ol className="relative grid grid-cols-2 gap-y-3 sm:grid-cols-5 sm:before:absolute sm:before:inset-x-2 sm:before:top-2 sm:before:h-0.5 sm:before:bg-border">
                      {st.map((s, i) => {
                        const differs = !isDefault && baseSteps !== null && baseSteps[i].value !== s.value;
                        const warn = s.k === "auto" && rule.config.neverAutoProcess;
                        return (
                          <li key={s.k} className="relative flex flex-col gap-0.5 pr-2">
                            <i aria-hidden className={cn("relative size-4 rounded-full border-2 bg-white", warn ? "border-[#B07C0E] bg-[#B07C0E]" : differs ? "border-primary bg-primary" : "border-[#B9B5AC]")} />
                            <small className="mt-1.5 text-[11.5px] text-muted-foreground">{s.label}</small>
                            <span className={cn("text-[13.5px] leading-snug", differs ? "font-semibold text-[#0B5F56]" : "font-medium")}>
                              {s.value}{differs && <span className="sr-only"> (distinto de la predeterminada)</span>}
                            </span>
                          </li>
                        );
                      })}
                    </ol>
                    {canManage && <span className={btn("secondary", "sm")}>Editar</span>}
                  </Wrapper>
                );
              })}
            </div>
          </section>
        );
      })}

      <p className="mt-5 text-[12.5px] text-muted-foreground">
        Las categorías vienen del campo de categoría del proveedor en el ERP y se actualizan al sincronizar los catálogos. {rules.length} de {maxRules} reglas.
      </p>

      {editor && c && (
        <Drawer
          title={editor.id ? ruleTitle({ scope: editor.scope, targetKey: editor.targetKey, targetLabel: editor.targetLabel || null }) : "Nueva regla"}
          description={editor.id ? "Cambia el camino que siguen sus facturas." : "Elige a qué proveedores aplica y su camino."}
          onClose={() => setEditor(null)}
          locked={saving}
          width={520}
          footer={<>
            {editor.id && (confirmDelete ? (
              <span className="mr-auto flex items-center gap-3 text-[13px]">
                <span className="text-tone-err">¿Eliminar esta regla?</span>
                <button type="button" onClick={remove} disabled={saving} className="font-semibold text-tone-err hover:underline">Eliminar</button>
                <button type="button" onClick={() => setConfirmDelete(false)} className="text-muted-foreground hover:text-foreground">No</button>
              </span>
            ) : (
              <button type="button" onClick={() => setConfirmDelete(true)} className={btn("text", "md", "mr-auto px-0 hover:text-tone-err")}><Trash2 />Eliminar</button>
            ))}
            <button type="button" onClick={() => setEditor(null)} disabled={saving} className={btn("secondary")}>Cancelar</button>
            <button type="button" onClick={save} disabled={saving || !canSubmit} className={btn("primary")}>{saving && <Loader2 className="animate-spin" />}Guardar regla</button>
          </>}
        >
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
                    <p className="text-[13px] text-muted-foreground">No hay categorías en el catálogo. Sincroniza los proveedores desde Catálogos del ERP después de asignarles categoría en el ERP.</p>
                  ) : (
                    <select id="vr-cat" className={inputCls} value={editor.targetKey} onChange={(e) => setEditor({ ...editor, targetKey: e.target.value, targetLabel: categoryById.get(e.target.value)?.name ?? "" })}>
                      <option value="">Elige una categoría</option>
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
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <input id="vr-vendor" className={cn(inputCls, "pl-9")} value={editor.targetKey ? editor.targetLabel : vendorQuery} placeholder="Nombre o ID del proveedor" onChange={(e) => { setEditor({ ...editor, targetKey: "", targetLabel: "" }); searchVendors(e.target.value); }} />
                    {searching && <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
                  </div>
                  {!editor.targetKey && vendorOptions.length > 0 && (
                    <div className="absolute top-full z-20 mt-1 max-h-52 w-full overflow-auto rounded-lg border border-border bg-card py-1 shadow-md">
                      {vendorOptions.map((v) => (
                        <button type="button" key={v.internalId} onClick={() => { setEditor({ ...editor, targetKey: v.internalId, targetLabel: v.name || v.entityid }); setVendorOptions([]); }} className="block w-full px-3 py-2 text-left text-[13px] hover:bg-secondary">
                          <span className="block font-medium">{v.name || v.entityid}</span>
                          <span className="text-muted-foreground">#{v.internalId}{v.entityid ? ` · ${v.entityid}` : ""}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <div className="border-t border-line-soft" />
            </>
          )}

          <ol className="flex flex-col gap-5">
            <PathStep n={1} title="Orden de compra">
              <select id="vr-po" aria-label="Orden de compra" className={inputCls} value={c.poRequirement} onChange={(e) => setConfig({ poRequirement: e.target.value as VendorRuleConfig["poRequirement"], ...(e.target.value === "none" ? { requireReceipt: false } : {}) })}>
                <option value="required">Obligatoria</option>
                <option value="optional">Opcional</option>
                <option value="none">Sin OC</option>
              </select>
            </PathStep>
            {c.poRequirement !== "none" && (
              <>
                <PathStep n={2} title="Recepción">
                  <label className="flex items-center justify-between gap-3 text-[13.5px]">
                    <span>Exigir entrada de almacén{!features.threeWay && <span className="block text-xs text-muted-foreground">Requiere activar la validación con recepción</span>}</span>
                    <Switch checked={c.requireReceipt} onCheckedChange={(v) => setConfig({ requireReceipt: v })} aria-label="Exigir entrada de almacén" />
                  </label>
                </PathStep>
                <PathStep n={3} title="Tolerancia">
                  <div className="flex gap-3">
                    <label className="flex flex-1 flex-col gap-1.5 text-[13px]">Del total %
                      <PctInput placeholder="General" value={c.totalTolerancePct} onChange={(v) => setConfig({ totalTolerancePct: v })} />
                    </label>
                    <label className="flex flex-1 flex-col gap-1.5 text-[13px]">Del precio %
                      <PctInput placeholder="General" value={c.priceTolerancePct} onChange={(v) => setConfig({ priceTolerancePct: v })} />
                    </label>
                  </div>
                </PathStep>
                <PathStep n={4} title="Si no cuadra">
                  <select aria-label="Si no cuadra" className={inputCls} value={c.onMismatch ?? ""} onChange={(e) => setConfig({ onMismatch: (e.target.value || null) as VendorRuleConfig["onMismatch"] })}>
                    <option value="">Según la configuración general</option>
                    {Object.entries(MISMATCH_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </PathStep>
              </>
            )}
            <PathStep n={c.poRequirement !== "none" ? 5 : 2} title="Envío solo al ERP">
              <label className="flex items-center justify-between gap-3 text-[13.5px]">
                <span>Siempre enviar a revisión</span>
                <Switch checked={c.neverAutoProcess} onCheckedChange={(v) => setConfig({ neverAutoProcess: v })} aria-label="Siempre enviar a revisión" />
              </label>
              {!c.neverAutoProcess && (
                <label className="flex flex-col gap-1.5 text-[13px]">Con confianza de lectura de al menos %
                  <PctInput placeholder={`${orgThresholdPct} (general)`} value={c.autoProcessPct} onChange={(v) => setConfig({ autoProcessPct: v })} />
                </label>
              )}
              <label className="flex items-center justify-between gap-3 text-[13.5px]">
                <span>Exigir validación SAT{!features.sat && <span className="block text-xs text-muted-foreground">Requiere activar la validación fiscal del CFDI</span>}</span>
                <Switch checked={c.satRequired} onCheckedChange={(v) => setConfig({ satRequired: v })} aria-label="Exigir validación SAT" />
              </label>
            </PathStep>
          </ol>

          {error && <p role="alert" className="text-sm text-tone-err">{error}</p>}
        </Drawer>
      )}
    </PageFrame>
  );
}

function PathStep({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[22px_minmax(0,1fr)] gap-3">
      <span aria-hidden className="mt-px flex size-[22px] items-center justify-center rounded-full bg-tone-info-bg text-[11px] font-bold text-tone-info">{n}</span>
      <div className="flex flex-col gap-2.5">
        <b className="text-sm font-semibold">{title}</b>
        {children}
      </div>
    </li>
  );
}
