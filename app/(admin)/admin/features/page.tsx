"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Panel, PanelTitle, Main, Label, SectionTitle, PRODUCT_NAME } from "@/components/admin/ui";
import { ProductArt } from "@/components/admin/product-art";
import { FilterLink } from "@/components/admin/filter-link";

interface Feature {
  id: string; name: string; description: string | null; category: string; featureType: string;
  defaultEnabled: boolean; planRequired: string; isBeta: boolean; sortOrder: number; productKey: string | null;
  stats: { eligible: number; overrides: number; active: number };
}

const GROUPS: Array<{ key: string | null; title: string }> = [
  { key: "ap_automation", title: "AP Automation" },
  { key: "contract_intelligence", title: "Contract Intelligence" },
  { key: "expense_management", title: "Expense Management" },
  { key: null, title: "Plataforma" },
];
const PLANS = ["starter", "growth", "enterprise"] as const;
const PLAN_LABEL: Record<string, string> = { starter: "Starter", growth: "Growth", enterprise: "Enterprise" };

export default function FeaturesCatalogPage() {
  const [features, setFeatures] = useState<Feature[]>([]);
  const [productClients, setProductClients] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [product, setProduct] = useState<string | "all" | "platform">("all");
  const [plan, setPlan] = useState<string | null>(null);
  const [pending, setPending] = useState<{ feature: Feature; next: boolean; affected: number } | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const res = await fetch("/api/admin/features", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setFeatures(data.features); setProductClients(data.productClients ?? {}); setTotal(data.total ?? 0);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "No se pudo cargar el catálogo");
    } finally {
      setLoading(false);
    }
  }
  // Deferred so the loader's setState isn't called synchronously in the effect body.
  useEffect(() => { queueMicrotask(() => { void load(); }); }, []);

  const visible = useMemo(() => features.filter((f) => {
    if (product === "platform" && f.productKey) return false;
    if (product !== "all" && product !== "platform" && f.productKey !== product) return false;
    if (plan && f.planRequired !== plan) return false;
    if (search) { const q = search.toLowerCase(); if (!f.name.toLowerCase().includes(q) && !(f.description ?? "").toLowerCase().includes(q) && !f.id.includes(q)) return false; }
    return true;
  }), [features, product, plan, search]);

  async function askToggle(f: Feature, next: boolean) {
    const res = await fetch(`/api/admin/features/${f.id}`);
    const data = await res.json().catch(() => ({}));
    setPending({ feature: f, next, affected: Number(data.impact?.affected ?? 0) });
  }

  async function confirmToggle() {
    if (!pending) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/features/${pending.feature.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ defaultEnabled: pending.next }) });
      if (!res.ok) { setError("No se pudo guardar el valor por defecto"); return; }
      setPending(null);
      await load();
    } finally {
      setSaving(false);
    }
  }

  const counts = useMemo(() => ({
    platform: features.filter((f) => !f.productKey).length,
    byProduct: Object.fromEntries(GROUPS.filter((g) => g.key).map((g) => [g.key as string, features.filter((f) => f.productKey === g.key).length])),
    byPlan: Object.fromEntries(PLANS.map((p) => [p, features.filter((f) => f.planRequired === p).length])),
  }), [features]);

  return (
    <>
      <Panel>
        <PanelTitle title="Catálogo de features" subtitle={`${features.length} features · 3 productos + plataforma`} />
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar feature" aria-label="Buscar feature" className="w-full text-[13px] px-3 py-2 rounded-lg border border-border bg-background" />
        <div className="flex flex-col gap-0.5">
          <div className="px-2.5 mb-1.5"><Label>Producto</Label></div>
          <FilterLink active={product === "all"} onClick={() => setProduct("all")} count={features.length}>Todos</FilterLink>
          {GROUPS.filter((g) => g.key).map((g) => <FilterLink key={g.key} active={product === g.key} onClick={() => setProduct(g.key!)} count={counts.byProduct[g.key!]}>{g.title}</FilterLink>)}
          <FilterLink active={product === "platform"} onClick={() => setProduct("platform")} count={counts.platform}>Plataforma</FilterLink>
        </div>
        <div className="flex flex-col gap-0.5">
          <div className="px-2.5 mb-1.5"><Label>Plan mínimo</Label></div>
          {PLANS.map((p) => <FilterLink key={p} active={plan === p} onClick={() => setPlan(plan === p ? null : p)} count={counts.byPlan[p]}>{PLAN_LABEL[p]}</FilterLink>)}
        </div>
        <p className="mt-auto text-xs text-muted-foreground leading-relaxed">El valor por defecto aplica a los clientes sin ajuste propio. Cambiarlo pide confirmación y dice a cuántos afecta.</p>
      </Panel>

      <Main width="max-w-[1100px]">
        {loading && <p className="text-sm text-muted-foreground inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Cargando catálogo…</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!loading && GROUPS.filter((g) => product === "all" || (product === "platform" ? g.key === null : g.key === product)).map((g) => {
          const list = visible.filter((f) => f.productKey === g.key);
          if (!list.length) return null;
          const clients = g.key ? (productClients[g.key] ?? 0) : total;
          return (
            <section key={g.key ?? "platform"}>
              <SectionTitle aside={`${list.length} feature${list.length === 1 ? "" : "s"} · ${clients} cliente${clients === 1 ? "" : "s"}`}>
                <span className="inline-flex items-center gap-2.5">{g.key && <ProductArt product={g.key} className="w-9 -my-2" />}{g.title}</span>
              </SectionTitle>
              <div className="grid grid-cols-[minmax(0,1fr)_90px_170px_40px] gap-5 py-2 text-[11px] font-medium tracking-[0.06em] uppercase text-muted-foreground"><span>Feature</span><span>Plan</span><span>En clientes</span><span>Def.</span></div>
              <ul className="divide-y divide-border/70">
                {list.map((f) => (
                  <li key={f.id} className="grid grid-cols-[minmax(0,1fr)_90px_170px_40px] gap-5 items-center py-3">
                    <div className="min-w-0"><div className="font-medium">{f.name}{f.isBeta && <span className="ml-2 text-[10px] uppercase tracking-wider text-[oklch(0.50_0.14_80)]">beta</span>}</div><div className="text-xs text-muted-foreground">{f.description}</div></div>
                    <span className="text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground border border-border rounded px-1.5 py-px w-fit">{f.planRequired}</span>
                    <span className="text-xs tabular-nums"><strong className="font-semibold">{f.stats.active}</strong> activa · {f.stats.overrides} ajuste{f.stats.overrides === 1 ? "" : "s"}</span>
                    <Switch checked={f.defaultEnabled} onCheckedChange={(v) => askToggle(f, Boolean(v))} aria-label={`Valor por defecto de ${f.name}`} />
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        {!loading && !visible.length && !error && <p className="text-sm text-muted-foreground">Sin features con esos filtros.</p>}
      </Main>

      {pending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "oklch(0.18 0.015 258 / 0.45)" }} onClick={(e) => { if (e.target === e.currentTarget && !saving) setPending(null); }}>
          <div role="dialog" aria-modal="true" className="w-full max-w-[520px] bg-card rounded-2xl p-7 flex flex-col gap-4" style={{ boxShadow: "0 20px 60px oklch(0.18 0.015 258 / 0.18)" }}>
            <h2 className="text-[18px] font-semibold tracking-[-0.02em]">{pending.next ? "Activar" : "Desactivar"} &ldquo;{pending.feature.name}&rdquo; por defecto</h2>
            <p className="text-sm text-muted-foreground">
              {pending.affected === 0
                ? "Ningún cliente cambia: todos los que tienen el producto ya definieron su propio valor."
                : <>{pending.next ? "La encenderá" : "La apagará"} en <strong className="text-foreground">{pending.affected} cliente{pending.affected === 1 ? "" : "s"}</strong> que no tienen un ajuste propio. Los {pending.feature.stats.overrides} con ajuste no cambian.</>}
              {pending.feature.productKey ? ` Aplica a clientes con ${PRODUCT_NAME[pending.feature.productKey] ?? pending.feature.productKey}.` : ""}
            </p>
            <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setPending(null)} disabled={saving}>Cancelar</Button><Button onClick={confirmToggle} disabled={saving}>{saving && <Loader2 className="animate-spin" />}Confirmar</Button></div>
          </div>
        </div>
      )}
    </>
  );
}
