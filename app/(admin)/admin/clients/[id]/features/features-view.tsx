"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { ArrowRight, Loader2, Search, SlidersHorizontal } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Pill, Chip, Notice, fmtDate } from "@/components/admin/ui";
import { Field, TextInput, Select } from "@/components/admin/form";
import { ProductArt } from "@/components/admin/product-art";
import { FeatureConfigPanel, type ConfigParam } from "@/components/admin/feature-config-panel";

export interface ProductState {
  key: string; name: string; description: string; requiresIntegration: boolean;
  status: "active" | "trial" | "disabled"; contracted: boolean; enabledAt: string | null;
  maxFlows: number; playbook: string;
}

export interface FeatureRow {
  id: string; name: string; description: string | null; category: string;
  featureType: "boolean" | "config" | "boolean_config";
  defaultConfig: Record<string, unknown> | null;
  configSchema: ConfigParam[] | null;
  planRequired: "starter" | "growth" | "enterprise"; isBeta: boolean;
  adminGranted: boolean; tenantEnabled: boolean; isEnabled: boolean;
  config: Record<string, unknown>; notes: string | null; enabledBy: string | null;
  product: string | null; hasOverride: boolean;
}

const PRODUCT_SUB: Record<string, string> = {
  ap_automation: "Facturas y órdenes hacia el ERP · requiere conexión ERP",
  expense_management: "Informes de gastos de empleados · requiere conexión ERP",
  contract_intelligence: "Análisis, validación cruzada y generación documental · sin integración",
};
const PLAN_LABEL: Record<string, string> = { starter: "Starter", growth: "Growth", enterprise: "Enterprise" };

function hasConfig(f: FeatureRow) { return f.id === "custom_netsuite_forms" || (f.featureType !== "boolean" && (f.configSchema?.length ?? 0) > 0); }

/**
 * Products and their features for one client, as dense rows: one line per
 * feature, the switch on the left, parameters behind a "Configurar" drawer.
 */
export function FeaturesView({ orgId, products, features, subsidiaries, playbooks, erpConnected }: {
  orgId: string; products: ProductState[]; features: FeatureRow[]; subsidiaries: Array<{ id: string; name: string }>; playbooks: Array<{ key: string; name: string }>;
  /** Whether the active ERP environment has a tested connection. */
  erpConnected: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState(products);
  const [rows, setRows] = useState(features);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [configuring, setConfiguring] = useState<FeatureRow | null>(null);

  async function saveProducts(next: ProductState[], changedKey: string) {
    setSaving(changedKey);
    setError("");
    try {
      const res = await fetch(`/api/admin/clients/${orgId}/products`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ products: next.map((p) => ({
          key: p.key, status: p.contracted ? p.status === "disabled" ? "active" : p.status : "disabled",
          ...(p.key === "contract_intelligence" ? { config: { maxFlows: p.maxFlows, playbook: p.playbook } } : {}),
        })) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "No se pudo guardar"); setState(products); return; }
      setState(next);
      router.refresh();
    } catch {
      setError("No se pudo conectar al servidor");
      setState(products);
    } finally {
      setSaving(null);
    }
  }

  function toggleProduct(key: string, on: boolean) {
    const next = state.map((p) => (p.key === key ? { ...p, contracted: on, status: on ? "active" as const : "disabled" as const } : p));
    if (!next.some((p) => p.contracted)) { setError("El cliente debe conservar al menos un producto."); return; }
    setState(next);
    void saveProducts(next, key);
  }

  function updateContracts(patch: Partial<ProductState>) {
    setState((s) => s.map((p) => (p.key === "contract_intelligence" ? { ...p, ...patch } : p)));
  }

  /** PATCH one feature; returns false (and restores the row) on failure. */
  async function saveFeature(f: FeatureRow, patch: { adminGranted?: boolean; config?: Record<string, unknown>; notes?: string }): Promise<boolean> {
    const before = rows;
    const next = { ...f, ...patch, hasOverride: true };
    setRows((r) => r.map((x) => (x.id === f.id ? next : x)));
    setSaving(f.id); setError("");
    try {
      const res = await fetch(`/api/admin/clients/${orgId}/features/${f.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminGranted: next.adminGranted, config: next.config, notes: next.notes ?? "" }),
      });
      if (!res.ok) throw new Error();
      router.refresh();
      return true;
    } catch {
      setRows(before);
      setError(`No se pudo guardar "${f.name}".`);
      return false;
    } finally {
      setSaving(null);
    }
  }

  const q = search.trim().toLowerCase();
  const matches = (f: FeatureRow) => !q || f.name.toLowerCase().includes(q) || (f.description ?? "").toLowerCase().includes(q);
  const groups: Array<{ key: string | null; title: string; sub: string }> = [
    ...state.map((p) => ({ key: p.key, title: p.name, sub: PRODUCT_SUB[p.key] ?? p.description })),
    { key: null, title: "Plataforma", sub: "Compartidas por todos los productos. Siempre disponibles para conceder." },
  ];
  const totalOn = rows.filter((f) => f.adminGranted && (!f.product || state.find((p) => p.key === f.product)?.contracted)).length;
  const erpProducts = state.filter((p) => p.contracted && p.requiresIntegration);
  const erpHref = `/admin/clients/${orgId}/erp`;

  return (
    <>
      {erpProducts.length > 0 && !erpConnected && (
        <Notice
          tone="warn"
          title={`${erpProducts.map((p) => p.name).join(" y ")} necesita${erpProducts.length === 1 ? "" : "n"} una conexión al ERP.`}
          action={<Button nativeButton={false} render={<Link href={erpHref} />}>Configurar conexión <ArrowRight /></Button>}
        >
          Sin credenciales probadas no se sincroniza nada. Se configura en la pestaña Conexión ERP del expediente.
        </Notice>
      )}
      <div className="flex items-end justify-between gap-6 -mb-4">
        <p className="text-[15px] text-muted-foreground max-w-[58ch]">
          Cada cambio se aplica al instante y queda en Auditoría. <span className="text-foreground font-medium">{totalOn} features activas</span> en los productos contratados.
        </p>
        <label className="relative block w-[260px] shrink-0">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <TextInput type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar feature" aria-label="Buscar feature" className="pl-9 py-2" />
        </label>
      </div>
      {error && <p className="text-sm text-destructive -mb-6">{error}</p>}

      {groups.map((g) => {
        const product = g.key ? state.find((p) => p.key === g.key) : null;
        const list = rows.filter((f) => f.product === g.key);
        const shown = list.filter(matches);
        const activeCount = list.filter((f) => f.adminGranted).length;
        const contracted = product ? product.contracted : true;
        const open = contracted && !(collapsed[g.key ?? "platform"] ?? false);
        if (q && shown.length === 0) return null;
        return (
          <section key={g.key ?? "platform"} className={cn("rounded-2xl border bg-card overflow-hidden", contracted ? "border-border" : "border-dashed border-border")}>
            <header className={cn("flex items-center gap-4 px-5 py-3.5", open && "border-b border-border bg-secondary/40")}>
              {product ? (
                <Switch checked={product.contracted} onCheckedChange={(v) => toggleProduct(product.key, Boolean(v))} disabled={saving !== null} aria-label={`${product.name} contratado`} />
              ) : <span className="w-8" />}
              {g.key ? <span className={cn("w-12 shrink-0 transition-opacity", !contracted && "opacity-50")}><ProductArt product={g.key} /></span> : <span className="w-12 h-9 shrink-0 rounded-lg bg-secondary" />}
              <div className="flex-1 min-w-0">
                <div className={cn("font-semibold", !contracted && "text-muted-foreground")}>{g.title}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {g.sub}{product?.contracted && product.enabledAt ? ` · activo desde ${fmtDate(product.enabledAt)}` : ""}
                  {product && !product.contracted ? ` · No contratado. Al activarlo se habilitan ${list.length} features.` : ""}
                </div>
              </div>
              {saving === g.key && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
              {product?.contracted && product.requiresIntegration && (
                <Link href={erpHref} className="inline-flex items-center gap-1.5 text-xs font-medium text-primary whitespace-nowrap hover:underline underline-offset-4">
                  <span className={cn("w-1.5 h-1.5 rounded-full", erpConnected ? "bg-success" : "bg-[oklch(0.70_0.14_80)]")} />
                  {erpConnected ? "Conexión ERP" : "Conectar ERP"}
                </Link>
              )}
              {contracted && <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">{activeCount} de {list.length} activas</span>}
              {contracted && list.length > 0 && !q && (
                <button type="button" onClick={() => setCollapsed((c) => ({ ...c, [g.key ?? "platform"]: open }))} className="text-xs text-primary whitespace-nowrap">{open ? "Ocultar" : "Mostrar"}</button>
              )}
            </header>

            {product?.key === "contract_intelligence" && product.contracted && open && (
              <div className="px-5 py-4 border-b border-border grid grid-cols-[140px_minmax(0,320px)_auto] gap-4 items-end">
                <Field label="Máximo de flujos"><TextInput type="number" min={1} max={50} value={product.maxFlows} onChange={(e) => updateContracts({ maxFlows: Math.max(1, Math.min(50, Number(e.target.value) || 1)) })} className="tabular-nums" /></Field>
                <Field label="Playbook precargado"><Select value={product.playbook} onChange={(e) => updateContracts({ playbook: e.target.value })}>{playbooks.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}</Select></Field>
                <Button variant="outline" disabled={saving !== null} onClick={() => saveProducts(state, "contract_intelligence")}>Guardar</Button>
              </div>
            )}

            {open && shown.length > 0 && (
              <ul className="divide-y divide-border/70">
                {shown.map((f) => {
                  const always = f.featureType === "config";
                  const on = always || f.adminGranted;
                  return (
                    <li key={f.id} className={cn("grid grid-cols-[36px_minmax(0,1fr)_auto_auto] items-center gap-4 px-5 py-2.5 transition-colors", !on && "text-muted-foreground")}>
                      <span className="flex items-center">
                        {always
                          ? <span className="w-8 h-[18px] rounded-full bg-success/15 inline-flex items-center justify-center" title="Siempre activa"><span className="w-2 h-2 rounded-full bg-success" /></span>
                          : <Switch checked={f.adminGranted} disabled={saving !== null} onCheckedChange={(v) => saveFeature(f, { adminGranted: Boolean(v) })} aria-label={f.name} />}
                      </span>
                      <div className="min-w-0">
                        <div className={cn("text-sm font-medium flex items-center gap-2 flex-wrap", on ? "text-foreground" : "text-foreground/70")}>
                          {f.name}
                          {f.isBeta && <span className="text-[10px] uppercase tracking-wider text-[oklch(0.50_0.14_80)]">beta</span>}
                          {f.id === "netsuite_dry_run" && f.adminGranted && <Chip>{f.tenantEnabled ? "cliente: activo" : "cliente: apagado"}</Chip>}
                          {f.hasOverride && <span className="text-[11px] text-muted-foreground">ajuste propio</span>}
                        </div>
                        {f.description && <div className="text-xs text-muted-foreground truncate">{f.description}</div>}
                      </div>
                      <Pill tone="mute">{PLAN_LABEL[f.planRequired] ?? f.planRequired}</Pill>
                      <span className="w-[110px] flex justify-end">
                        {saving === f.id ? <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /> : hasConfig(f) && (
                          <button type="button" onClick={() => setConfiguring(f)} className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline underline-offset-4">
                            <SlidersHorizontal className="w-3.5 h-3.5" /> Configurar
                          </button>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
      {q && !rows.some(matches) && <p className="text-sm text-muted-foreground">Ninguna feature coincide con &ldquo;{search}&rdquo;.</p>}

      {configuring && (
        <FeatureConfigPanel
          feature={configuring}
          subsidiaries={subsidiaries}
          onClose={() => setConfiguring(null)}
          onSave={(config, notes) => saveFeature(configuring, { config, notes })}
        />
      )}
    </>
  );
}
