"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Panel, PanelTitle, Kv, Main, SectionTitle, Pill, StickyActions, Chip, initials } from "@/components/admin/ui";
import { Field, TextInput, PrefixedInput, Select, PasswordInput, ChoiceCards, TimezoneSelect, generatePassword, control } from "@/components/admin/form";
import { ProductArt } from "@/components/admin/product-art";
import { PRODUCTS, FEATURE_PRODUCT, type ProductKey } from "@/lib/products/registry";
import { FEATURE_CATALOG } from "@/lib/features/catalog";
import { TENANT_ROLE_LABELS } from "@/lib/auth/permissions";

type Step = "products" | "org" | "features" | "erp" | "user" | "done";
type Plan = "starter" | "growth" | "enterprise";
const STEP_LABEL: Record<Exclude<Step, "done">, string> = { products: "Productos", org: "Organización", features: "Features", erp: "Conexión ERP", user: "Primer usuario" };
const PLAN_RANK: Record<Plan, number> = { starter: 0, growth: 1, enterprise: 2 };
const PLAN_LABEL: Record<Plan, string> = { starter: "Starter", growth: "Growth", enterprise: "Enterprise" };
const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,98}[a-z0-9])?$/;
const EMPTY_CREDS = { accountId: "", consumerKey: "", consumerSecret: "", tokenId: "", tokenSecret: "" };

type CatalogFeature = (typeof FEATURE_CATALOG)[number];

function slugify(s: string) { return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }

async function post(path: string, body: unknown) {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok && data.ok !== false, data };
}

/** Product-first onboarding: products → organization → features → ERP (only when needed, skippable) → first user. */
export function ClientWizard({ playbooks }: { playbooks: Array<{ key: string; name: string }> }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("products");
  const [selected, setSelected] = useState<Set<ProductKey>>(new Set(["ap_automation"]));
  const [maxFlows, setMaxFlows] = useState(3);
  const [playbook, setPlaybook] = useState(playbooks[0]?.key ?? "");
  const [org, setOrg] = useState({ name: "", slug: "", slugTouched: false, timezone: "America/Mexico_City", billingEmail: "", planId: "starter" as Plan });
  const [slugError, setSlugError] = useState("");
  const [grants, setGrants] = useState<Record<string, boolean>>(() => Object.fromEntries(FEATURE_CATALOG.map((f) => [f.id, f.defaultEnabled])));
  const [orgId, setOrgId] = useState<string | null>(null);
  const [creds, setCreds] = useState(EMPTY_CREDS);
  const [scripts, setScripts] = useState({ catalogScriptId: "", catalogDeployId: "", processScriptId: "", processDeployId: "" });
  const [tested, setTested] = useState(false);
  const [probed, setProbed] = useState<string | null>(null);
  const [nsSubs, setNsSubs] = useState<Array<{ internal_id: string; name: string; currency: string; country: string; tax_id?: string }> | null>(null);
  const [chosenSubs, setChosenSubs] = useState<Set<string>>(new Set());
  const [user, setUser] = useState({ email: "", fullName: "", password: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const needsErp = [...selected].some((k) => PRODUCTS.find((p) => p.key === k)?.requiresIntegration);
  const steps: Array<Exclude<Step, "done">> = needsErp ? ["products", "org", "features", "erp", "user"] : ["products", "org", "features", "user"];
  const stepIndex = step === "done" ? steps.length : steps.indexOf(step);

  // Features grouped by product; platform-wide ones (no product) go last.
  const groups = useMemo(() => {
    const byProduct = new Map<string | null, CatalogFeature[]>();
    for (const f of FEATURE_CATALOG) {
      const p = FEATURE_PRODUCT[f.id] ?? null;
      byProduct.set(p, [...(byProduct.get(p) ?? []), f]);
    }
    return byProduct;
  }, []);
  const featuresByProduct = useMemo(() => {
    const m: Record<string, { on: string[]; off: string[] }> = {};
    for (const [p, list] of groups) if (p) m[p] = { on: list.filter((f) => f.defaultEnabled).map((f) => f.name), off: list.filter((f) => !f.defaultEnabled).map((f) => f.name) };
    return m;
  }, [groups]);
  const abovePlan = (f: CatalogFeature) => PLAN_RANK[f.planRequired as Plan] > PLAN_RANK[org.planId];
  const relevant = useMemo(() => FEATURE_CATALOG.filter((f) => { const p = FEATURE_PRODUCT[f.id]; return !p || selected.has(p); }), [selected]);
  const onCount = relevant.filter((f) => grants[f.id] && !abovePlan(f)).length;
  const offCount = relevant.length - onCount;

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key); setError("");
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  }

  const checkOrg = () => run("slug", async () => {
    setSlugError("");
    if (!SLUG.test(org.slug)) { setSlugError("Solo minúsculas, números y guiones; mínimo 3 caracteres."); return; }
    const res = await fetch("/api/admin/clients?deleted=1").then((r) => r.json()).catch(() => ({ organizations: [] }));
    if ((res.organizations ?? []).some((o: { slug: string }) => o.slug === org.slug)) { setSlugError("Ese identificador ya está en uso."); return; }
    setStep("features");
  });
  const createOrg = () => run("org", async () => {
    const features = Object.fromEntries(relevant.filter((f) => !abovePlan(f)).map((f) => [f.id, grants[f.id]]));
    const { ok, data } = await post("/api/admin/clients", {
      name: org.name.trim(), slug: org.slug.trim(), timezone: org.timezone.trim(), billingEmail: org.billingEmail.trim() || null, planId: org.planId,
      products: [...selected], contractMaxFlows: selected.has("contract_intelligence") ? maxFlows : undefined, contractPlaybook: selected.has("contract_intelligence") ? playbook : undefined,
      features,
    });
    if (!ok) throw new Error(data.error ?? "No se pudo crear la organización");
    setOrgId(data.organizationId);
    setStep(needsErp ? "erp" : "user");
  });
  const testCreds = () => run("test", async () => {
    const { ok, data } = await post("/api/admin/ns/test-connection", creds);
    if (!ok) throw new Error(data.error ?? "La conexión falló");
    setTested(true);
  });
  const probeScripts = () => run("probe", async () => {
    const { ok, data } = await post("/api/admin/ns/probe-scripts", { ...creds, catalogScriptId: scripts.catalogScriptId, catalogDeployId: scripts.catalogDeployId });
    if (!ok) throw new Error(data.error ?? "El script de catálogo no responde");
    setProbed(data.version ?? "ok");
  });
  const fetchSubs = () => run("subs", async () => {
    const { ok, data } = await post("/api/admin/ns/subsidiaries", { ...creds, catalogScriptId: scripts.catalogScriptId, catalogDeployId: scripts.catalogDeployId });
    if (!ok) throw new Error(data.error ?? "No se pudieron leer las subsidiarias");
    setNsSubs(data.subsidiaries ?? []);
    setChosenSubs(new Set((data.subsidiaries ?? []).map((s: { internal_id: string }) => s.internal_id)));
  });
  const saveErp = () => run("save-erp", async () => {
    const { ok, data } = await post(`/api/admin/clients/${orgId}/connection`, { environment: "sandbox", ...creds, ...scripts, test: true, scriptsInstalled: Boolean(probed), installMethod: "manual" });
    if (!ok) throw new Error(data.error ?? "No se pudo guardar la conexión");
    if (nsSubs && chosenSubs.size) {
      const list = nsSubs.filter((s) => chosenSubs.has(s.internal_id)).map((s) => ({ nsSubsidiaryId: s.internal_id, name: s.name, currency: s.currency, taxId: s.tax_id }));
      const r = await post(`/api/admin/clients/${orgId}/subsidiaries`, { subsidiaries: list });
      if (!r.ok) throw new Error(r.data.error ?? "No se pudieron guardar las subsidiarias");
      // Catalog sync runs in the background; the client panel shows the result.
      const subsRes = await fetch(`/api/admin/clients/${orgId}/subsidiaries`).then((x) => x.json()).catch(() => ({ subsidiaries: [] }));
      for (const s of (subsRes.subsidiaries ?? []) as Array<{ id: string }>) void fetch(`/api/admin/clients/${orgId}/sync`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subsidiaryId: s.id }) }).catch(() => {});
    }
    setStep("user");
  });
  const createUser = () => run("user", async () => {
    const { ok, data } = await post(`/api/admin/clients/${orgId}/users`, { email: user.email.trim(), fullName: user.fullName.trim() || undefined, role: "admin", password: user.password });
    if (!ok) throw new Error(data.error ?? "No se pudo crear el usuario");
    setStep("done");
  });

  const orgValid = org.name.trim().length >= 2 && SLUG.test(org.slug);
  const field = control;

  return (
    <>
      <Panel>
        <PanelTitle
          eyebrow={<Link href={orgId ? `/admin/clients/${orgId}` : "/admin/clients"} className="hover:text-foreground">{orgId ? "← Salir del alta" : "← Cancelar alta"}</Link>}
          avatar={<div className={cn("w-14 h-14 rounded-2xl flex items-center justify-center text-[22px] font-bold", org.name.trim() ? "" : "border-[1.5px] border-dashed border-border text-muted-foreground")} style={org.name.trim() ? { backgroundColor: "oklch(0.22 0.10 240)", color: "oklch(0.65 0.14 182)" } : undefined}>{org.name.trim() ? initials(org.name) : "?"}</div>}
          title={org.name.trim() || "Nueva organización"}
          subtitle={step === "done" ? "Alta completa" : `${orgId ? "Creada · " : ""}paso ${stepIndex + 1} de ${steps.length}`}
        />
        <ol className="flex flex-col">
          {steps.map((s, i) => {
            const done = i < stepIndex;
            const on = s === step;
            return (
              <li key={s} className={cn("flex items-center gap-3 py-2 text-[13px]", on ? "font-medium" : !done && "text-muted-foreground")}>
                <span className={cn("w-[22px] h-[22px] rounded-full inline-flex items-center justify-center text-[11px] font-semibold", done ? "bg-success/10 text-success" : on ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground")}>{done ? "✓" : i + 1}</span>
                {STEP_LABEL[s]}{s === "erp" && <span className="ml-auto text-[11px] text-muted-foreground">omitible</span>}
              </li>
            );
          })}
        </ol>
        <div>
          <Kv label="Productos">{[...selected].map((k) => PRODUCTS.find((p) => p.key === k)?.name).join(" · ") || "ninguno"}</Kv>
          <Kv label="Features al inicio">{onCount} activas · {offCount} disponibles</Kv>
          <Kv label="Plan">{PLAN_LABEL[org.planId]} · trial de 30 días</Kv>
          <Kv label="Conexión ERP">{needsErp ? (step === "user" || step === "done" ? (tested ? "Sandbox probado" : "Pendiente, desde el expediente") : `Necesaria (paso ${steps.indexOf("erp") + 1})`) : "No requerida"}</Kv>
        </div>
        <p className="mt-auto text-xs text-muted-foreground leading-relaxed">
          {step === "erp" ? "Si omites este paso, el cliente aparece con \"ERP pendiente\" hasta completarlo desde su expediente." : step === "features" ? "Lo que dejes apagado queda disponible para activarlo después desde el expediente." : "Las features se activan o apagan después por cliente. Las de plataforma no dependen del producto."}
        </p>
      </Panel>

      <Main width="max-w-[1100px]">
        {error && <p className="text-sm text-destructive -mb-6">{error}</p>}

        {step === "products" && (
          <>
            <section className="-mb-4">
              <h2 className="text-[24px] font-semibold tracking-[-0.02em]">¿Qué va a usar este cliente?</h2>
              <p className="text-[15px] text-muted-foreground mt-2">Elige uno o varios. Cada producto muestra lo que se activa desde el primer día y lo que queda disponible; en el paso 3 ajustas feature por feature.</p>
            </section>
            {PRODUCTS.map((p) => {
              const on = selected.has(p.key);
              const fx = featuresByProduct[p.key] ?? { on: [], off: [] };
              return (
                <button key={p.key} type="button" onClick={() => setSelected((prev) => { const n = new Set(prev); if (n.has(p.key)) n.delete(p.key); else n.add(p.key); return n; })}
                  aria-pressed={on} className={cn("text-left rounded-2xl border bg-card p-6 grid grid-cols-[22px_minmax(0,1fr)] xl:grid-cols-[22px_minmax(0,1fr)_168px] gap-x-4 gap-y-4 xl:gap-x-7 items-start transition-[border-color,box-shadow]", on ? "border-primary shadow-[0_0_0_3px_oklch(0.48_0.15_182_/_0.08)]" : "border-border hover:border-foreground/30")}>
                  <span className={cn("mt-0.5 w-5 h-5 rounded-md border-[1.5px] inline-flex items-center justify-center text-white", on ? "bg-primary border-primary" : "border-border")}>{on && <CheckCircle2 className="w-3.5 h-3.5" />}</span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-2.5 flex-wrap"><span className="font-semibold text-[16px]">{p.name}</span><span className="text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground border border-border rounded px-1.5 py-px">{p.requiresIntegration ? "Requiere ERP" : "Sin integración"}</span></span>
                    <span className="block text-muted-foreground mt-1">{p.description.replace("NetSuite", "el ERP")}</span>
                    <span className="grid grid-cols-2 gap-x-6 gap-y-1 mt-3.5 text-[13px]">
                      {fx.on.map((n) => <span key={n} className="flex items-center gap-2"><Circle className="w-1.5 h-1.5 fill-primary text-primary" />{n}</span>)}
                      {fx.off.slice(0, 6).map((n) => <span key={n} className="flex items-center gap-2 text-muted-foreground"><Circle className="w-1.5 h-1.5 fill-border text-border" />{n}</span>)}
                      {fx.off.length > 6 && <span className="text-muted-foreground">+ {fx.off.length - 6} más</span>}
                    </span>
                    <span className="block mt-3 text-xs text-muted-foreground">{fx.on.length} activas desde el inicio · {fx.off.length} disponibles según plan</span>
                    {p.key === "contract_intelligence" && on && (
                      <span className="grid grid-cols-[150px_minmax(0,320px)] gap-4 mt-4 pt-4 border-t border-border/60" onClick={(e) => e.stopPropagation()}>
                        <Field label="Máximo de flujos"><TextInput type="number" min={1} max={50} value={maxFlows} onChange={(e) => setMaxFlows(Math.max(1, Math.min(50, Number(e.target.value) || 1)))} /></Field>
                        <Field label="Playbook inicial"><Select value={playbook} onChange={(e) => setPlaybook(e.target.value)}>{playbooks.map((pb) => <option key={pb.key} value={pb.key}>{pb.name}</option>)}</Select></Field>
                      </span>
                    )}
                  </span>
                  <span className={cn("hidden xl:block self-center rounded-xl p-3 transition-colors", on ? "bg-primary/5" : "bg-secondary/60")}>
                    <ProductArt product={p.key} className={cn("transition-opacity", on ? "opacity-100" : "opacity-70")} />
                  </span>
                </button>
              );
            })}
            <StickyActions>
              <span className="mr-auto text-xs text-muted-foreground">{selected.size ? `${selected.size} producto${selected.size === 1 ? "" : "s"} · ${onCount} features activas al inicio` : "Elige al menos un producto"}</span>
              <Button disabled={selected.size === 0} onClick={() => setStep("org")}>Continuar</Button>
            </StickyActions>
          </>
        )}

        {step === "org" && (
          <>
            <section className="-mb-4">
              <h2 className="text-[24px] font-semibold tracking-[-0.02em]">Datos de la organización.</h2>
              <p className="text-[15px] text-muted-foreground mt-2 max-w-[62ch]">Nombre, identificador y plan. El cliente arranca en trial de 30 días; todo lo demás se completa después desde su expediente.</p>
            </section>

            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-8 items-start">
              <div className="flex flex-col gap-8">
                <section className="rounded-2xl border border-border bg-card p-6 flex flex-col gap-5">
                  <SectionTitle>Identidad</SectionTitle>
                  <Field label="Nombre de la empresa" hint="Como aparecerá en el panel, en el portal del cliente y en la auditoría.">
                    <TextInput value={org.name} autoFocus onChange={(e) => setOrg({ ...org, name: e.target.value, slug: org.slugTouched ? org.slug : slugify(e.target.value) })} />
                  </Field>
                  <Field label="Identificador" error={slugError} hint={slugError ? undefined : "Se genera a partir del nombre. Minúsculas, números y guiones; no se puede cambiar una vez que el cliente tiene documentos."}>
                    <PrefixedInput prefix="docuia / " value={org.slug} onChange={(e) => { setSlugError(""); setOrg({ ...org, slug: slugify(e.target.value), slugTouched: true }); }} spellCheck={false} />
                  </Field>
                </section>

                <section className="rounded-2xl border border-border bg-card p-6 flex flex-col gap-5">
                  <SectionTitle>Operación</SectionTitle>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <Field label="Zona horaria" hint="Define el corte diario de métricas y los horarios de sincronización.">
                      <TimezoneSelect value={org.timezone} onChange={(v) => setOrg({ ...org, timezone: v })} />
                    </Field>
                    <Field label="Email de facturación" optional hint="Recibe avisos de fin de trial y de consumo.">
                      <TextInput type="email" value={org.billingEmail} onChange={(e) => setOrg({ ...org, billingEmail: e.target.value })} />
                    </Field>
                  </div>
                </section>

                <section className="rounded-2xl border border-border bg-card p-6 flex flex-col gap-5">
                  <SectionTitle aside="Cambia después desde el expediente">Plan</SectionTitle>
                  <ChoiceCards<Plan>
                    value={org.planId}
                    onChange={(v) => setOrg({ ...org, planId: v })}
                    options={[
                      { value: "starter", label: "Starter", description: "Lo esencial para operar: extracción, mapeo y sincronización.", meta: `${FEATURE_CATALOG.filter((f) => f.planRequired === "starter").length} features del catálogo` },
                      { value: "growth", label: "Growth", description: "Aprobaciones, duplicados, carga masiva, API y reportes.", meta: `+${FEATURE_CATALOG.filter((f) => f.planRequired === "growth").length} features` },
                      { value: "enterprise", label: "Enterprise", description: "Seguridad avanzada, gastos de empleados y métricas de contratos.", meta: `+${FEATURE_CATALOG.filter((f) => f.planRequired === "enterprise").length} features` },
                    ]}
                  />
                </section>
              </div>

              <aside className="rounded-2xl border border-border bg-card p-6 flex flex-col gap-4 lg:sticky lg:top-9">
                <div className="flex items-center gap-3.5">
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center text-[18px] font-bold shrink-0" style={{ backgroundColor: "oklch(0.22 0.10 240)", color: "oklch(0.65 0.14 182)" }}>{org.name.trim() ? initials(org.name) : "?"}</div>
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{org.name.trim() || "Nombre pendiente"}</div>
                    <div className="text-xs text-muted-foreground truncate">{org.slug || "identificador"}</div>
                  </div>
                </div>
                <div className="flex flex-col divide-y divide-border/60 text-[13px]">
                  <div className="py-2.5 flex justify-between gap-3"><span className="text-muted-foreground">Productos</span><span className="text-right">{[...selected].map((k) => PRODUCTS.find((p) => p.key === k)?.name).join(", ")}</span></div>
                  <div className="py-2.5 flex justify-between gap-3"><span className="text-muted-foreground">Plan</span><span>{PLAN_LABEL[org.planId]} · trial 30 días</span></div>
                  <div className="py-2.5 flex justify-between gap-3"><span className="text-muted-foreground">Features al inicio</span><span>{onCount} de {relevant.length}</span></div>
                  <div className="py-2.5 flex justify-between gap-3"><span className="text-muted-foreground">Conexión ERP</span><span>{needsErp ? "Paso siguiente, omitible" : "No requerida"}</span></div>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">Nada se guarda hasta el paso de features: ahí se crea la organización con todo lo elegido.</p>
              </aside>
            </div>

            <StickyActions className="justify-between">
              <Button variant="ghost" onClick={() => setStep("products")}>Atrás</Button>
              <Button disabled={busy !== null || !orgValid} onClick={checkOrg}>{busy === "slug" && <Loader2 className="animate-spin" />}Continuar</Button>
            </StickyActions>
          </>
        )}

        {step === "features" && (
          <>
            <section className="-mb-4 flex items-end justify-between gap-6">
              <div>
                <h2 className="text-[24px] font-semibold tracking-[-0.02em]">¿Con qué features arranca?</h2>
                <p className="text-[15px] text-muted-foreground mt-2 max-w-[64ch]">Vienen marcadas las de inicio de cada producto. Las que requieren un plan superior a {PLAN_LABEL[org.planId]} aparecen bloqueadas; se desbloquean cambiando el plan.</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button variant="outline" size="sm" onClick={() => setGrants((g) => ({ ...g, ...Object.fromEntries(relevant.map((f) => [f.id, f.defaultEnabled])) }))}>Solo las de inicio</Button>
                <Button variant="outline" size="sm" onClick={() => setGrants((g) => ({ ...g, ...Object.fromEntries(relevant.filter((f) => !abovePlan(f)).map((f) => [f.id, true])) }))}>Todas las del plan</Button>
              </div>
            </section>

            {[...PRODUCTS.filter((p) => selected.has(p.key)).map((p) => ({ key: p.key as string | null, title: p.name, list: groups.get(p.key) ?? [] })), { key: null, title: "Plataforma", list: groups.get(null) ?? [] }].map((g) => {
              const active = g.list.filter((f) => grants[f.id] && !abovePlan(f)).length;
              return (
                <section key={g.key ?? "platform"} className="rounded-2xl border border-border bg-card overflow-hidden">
                  <header className="flex items-center gap-4 px-5 py-3.5 border-b border-border bg-secondary/40">
                    {g.key ? <span className="w-12 shrink-0"><ProductArt product={g.key} /></span> : <span className="w-12 h-9 shrink-0 rounded-lg bg-secondary" />}
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold">{g.title}</div>
                      <div className="text-xs text-muted-foreground">{g.key ? "Features del producto" : "Compartidas por todos los productos"}</div>
                    </div>
                    <span className="text-xs text-muted-foreground tabular-nums">{active} de {g.list.length} activas</span>
                  </header>
                  <ul className="divide-y divide-border/70">
                    {g.list.map((f) => {
                      const locked = abovePlan(f);
                      const on = grants[f.id] && !locked;
                      return (
                        <li key={f.id} className={cn("grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 px-5 py-3", locked && "opacity-60")}>
                          <Switch checked={on} disabled={locked} onCheckedChange={(v) => setGrants((g2) => ({ ...g2, [f.id]: Boolean(v) }))} aria-label={f.name} />
                          <div className="min-w-0">
                            <div className="text-sm font-medium flex items-center gap-2 flex-wrap">{f.name}{f.isBeta && <span className="text-[10px] uppercase tracking-wider text-[oklch(0.50_0.14_80)]">beta</span>}{f.featureType !== "boolean" && <Chip>configurable</Chip>}</div>
                            <div className="text-xs text-muted-foreground">{f.description}</div>
                          </div>
                          <Pill tone={locked ? "warn" : "mute"}>{locked ? `Requiere ${PLAN_LABEL[f.planRequired as Plan]}` : PLAN_LABEL[f.planRequired as Plan]}</Pill>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}

            <StickyActions className="justify-between">
              <Button variant="ghost" disabled={busy !== null} onClick={() => setStep("org")}>Atrás</Button>
              <span className="flex items-center gap-4">
                <span className="text-xs text-muted-foreground">{onCount} activas · {offCount} disponibles</span>
                <Button disabled={busy !== null} onClick={createOrg}>{busy === "org" && <Loader2 className="animate-spin" />}Crear organización</Button>
              </span>
            </StickyActions>
          </>
        )}

        {step === "erp" && (
          <>
            <section className="-mb-4"><h2 className="text-[24px] font-semibold tracking-[-0.02em]">Conecta el ERP de sandbox.</h2><p className="text-[15px] text-muted-foreground mt-2 max-w-[58ch]">Lo necesita {[...selected].filter((k) => PRODUCTS.find((p) => p.key === k)?.requiresIntegration).map((k) => PRODUCTS.find((p) => p.key === k)?.name).join(" y ")}. Si aún no tienes las credenciales, omite el paso: la organización ya existe.</p></section>
            <section>
              <SectionTitle aside={tested ? <Pill tone="ok">Probadas</Pill> : undefined}>a · Credenciales de sandbox</SectionTitle>
              <div className="grid grid-cols-2 gap-4 mt-4 max-w-[640px]">
                <label className="col-span-2 max-w-[320px] text-xs text-muted-foreground flex flex-col gap-1">ID de cuenta (termina en _SB1)<input className={field} value={creds.accountId} onChange={(e) => { setCreds({ ...creds, accountId: e.target.value }); setTested(false); }} /></label>
                {(["consumerKey", "consumerSecret", "tokenId", "tokenSecret"] as const).map((k) => (
                  <label key={k} className="text-xs text-muted-foreground flex flex-col gap-1">{{ consumerKey: "Consumer key", consumerSecret: "Consumer secret", tokenId: "Token ID", tokenSecret: "Token secret" }[k]}<input className={field} type="password" autoComplete="off" value={creds[k]} onChange={(e) => { setCreds({ ...creds, [k]: e.target.value }); setTested(false); }} /></label>
                ))}
              </div>
              <div className="mt-3"><Button variant="outline" disabled={busy !== null || Object.values(creds).some((v) => !v.trim())} onClick={testCreds}>{busy === "test" && <Loader2 className="animate-spin" />}Probar conexión</Button></div>
            </section>
            <section>
              <SectionTitle aside={<a href="/api/scripts/netsuite/docuia-catalog-v1.js" download className="text-primary">Descargar scripts ↓</a>}>b · Scripts instalados en el ERP</SectionTitle>
              <div className="grid grid-cols-2 gap-4 mt-4 max-w-[640px]">
                {([["catalogScriptId", "Catálogo · Script ID"], ["catalogDeployId", "Catálogo · Deploy ID"], ["processScriptId", "Proceso · Script ID (opcional ahora)"], ["processDeployId", "Proceso · Deploy ID"]] as const).map(([k, l]) => (
                  <label key={k} className="text-xs text-muted-foreground flex flex-col gap-1">{l}<input className={cn(field, "font-mono text-xs")} value={scripts[k]} onChange={(e) => { setScripts({ ...scripts, [k]: e.target.value }); setProbed(null); }} /></label>
                ))}
              </div>
              <div className="mt-3 flex items-center gap-3"><Button variant="outline" disabled={busy !== null || !tested || !scripts.catalogScriptId || !scripts.catalogDeployId} onClick={probeScripts}>{busy === "probe" && <Loader2 className="animate-spin" />}Verificar catálogo</Button>{probed && <Pill tone="ok">Responde · {probed}</Pill>}</div>
            </section>
            <section>
              <SectionTitle aside={nsSubs ? `${nsSubs.length} encontradas en el ERP` : undefined}>c · Subsidiarias a gestionar</SectionTitle>
              {!nsSubs ? (
                <div className="mt-4"><Button variant="outline" disabled={busy !== null || !probed} onClick={fetchSubs}>{busy === "subs" && <Loader2 className="animate-spin" />}Obtener subsidiarias del ERP</Button>{!probed && <span className="text-xs text-muted-foreground ml-3">Verifica el catálogo primero.</span>}</div>
              ) : (
                <ul className="divide-y divide-border/70">
                  {nsSubs.map((s) => {
                    const on = chosenSubs.has(s.internal_id);
                    return (
                      <li key={s.internal_id}>
                        <label className="flex items-center gap-3.5 py-3 cursor-pointer">
                          <input type="checkbox" className="sr-only" checked={on} onChange={(e) => setChosenSubs((prev) => { const n = new Set(prev); if (e.target.checked) n.add(s.internal_id); else n.delete(s.internal_id); return n; })} />
                          <span className={cn("w-[18px] h-[18px] rounded-[5px] border-[1.5px] inline-flex items-center justify-center text-white", on ? "bg-primary border-primary" : "border-border")}>{on && "✓"}</span>
                          <span className="flex-1">{s.name}</span>
                          <span className="text-xs text-muted-foreground tabular-nums">ID {s.internal_id} · {s.currency}{s.tax_id ? ` · ${s.tax_id}` : ""}{s.country ? ` · ${s.country}` : ""}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="text-xs text-muted-foreground mt-3">El catálogo (ítems, proveedores, ubicaciones) se sincroniza en segundo plano al terminar el alta.</p>
            </section>
            <StickyActions>
              <Button variant="ghost" disabled={busy !== null} onClick={() => setStep("user")}>Omitir por ahora</Button>
              <Button disabled={busy !== null || !tested} onClick={saveErp}>{busy === "save-erp" && <Loader2 className="animate-spin" />}Guardar y continuar</Button>
            </StickyActions>
          </>
        )}

        {step === "user" && (
          <>
            <section className="-mb-4">
              <h2 className="text-[24px] font-semibold tracking-[-0.02em]">Crea la primera persona con acceso.</h2>
              <p className="text-[15px] text-muted-foreground mt-2 max-w-[62ch]">Entra como {TENANT_ROLE_LABELS.admin} del portal y desde ahí invita al resto de su equipo. Comparte la contraseña por un canal seguro; podrá cambiarla en su perfil.</p>
            </section>

            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-8 items-start">
              <section className="rounded-2xl border border-border bg-card p-6 flex flex-col gap-5">
                <div className="flex items-center gap-3.5">
                  <div className="w-12 h-12 rounded-full flex items-center justify-center text-[16px] font-semibold shrink-0 bg-primary/10 text-primary">{user.fullName.trim() ? initials(user.fullName) : (user.email.trim()[0]?.toUpperCase() ?? "?")}</div>
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{user.fullName.trim() || user.email.trim() || "Nueva persona"}</div>
                    <div className="text-xs text-muted-foreground">{TENANT_ROLE_LABELS.admin} · {org.name}</div>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <Field label="Nombre completo" optional><TextInput value={user.fullName} autoFocus onChange={(e) => setUser({ ...user, fullName: e.target.value })} /></Field>
                  <Field label="Email" hint="Es su usuario para entrar al portal."><TextInput type="email" value={user.email} onChange={(e) => setUser({ ...user, email: e.target.value })} /></Field>
                </div>
                <Field label="Contraseña inicial" hint={user.password.length > 0 && user.password.length < 8 ? "Mínimo 8 caracteres." : "Genera una segura o escribe una; mínimo 8 caracteres."}>
                  <PasswordInput value={user.password} onChange={(v) => setUser({ ...user, password: v })} onGenerate={() => setUser({ ...user, password: generatePassword() })} autoComplete="new-password" />
                </Field>
              </section>

              <aside className="rounded-2xl border border-border bg-card p-6 flex flex-col gap-3 text-[13px]">
                <div className="font-semibold">Como {TENANT_ROLE_LABELS.admin} podrá</div>
                <ul className="flex flex-col gap-2 text-muted-foreground">
                  {["Invitar y administrar a su equipo", "Configurar aprobaciones y reglas", "Ver y procesar todos los documentos", "Cambiar su contraseña desde el perfil"].map((t) => (
                    <li key={t} className="flex gap-2.5"><CheckCircle2 className="w-4 h-4 text-success shrink-0 mt-px" />{t}</li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground leading-relaxed border-t border-border/60 pt-3 mt-1">Puedes crear más usuarios y cambiar roles desde la pestaña Usuarios del expediente.</p>
              </aside>
            </div>

            <StickyActions className="justify-between">
              <Button variant="ghost" onClick={() => router.push(`/admin/clients/${orgId}`)}>Hacerlo después</Button>
              <Button disabled={busy !== null || !user.email.trim() || user.password.length < 8} onClick={createUser}>{busy === "user" && <Loader2 className="animate-spin" />}Crear usuario</Button>
            </StickyActions>
          </>
        )}

        {step === "done" && (
          <section className="rounded-2xl border border-border bg-card p-10 flex flex-col items-center text-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-success/10 flex items-center justify-center"><CheckCircle2 className="w-7 h-7 text-success" /></div>
            <div><h2 className="text-[20px] font-semibold tracking-[-0.02em]">{org.name} está lista.</h2><p className="text-[15px] text-muted-foreground mt-1 max-w-[46ch]">{needsErp && !tested ? "Falta conectar el ERP; el expediente lo muestra como siguiente paso." : "Puedes gestionar productos, features y usuarios desde su expediente."}</p></div>
            <div className="flex gap-2"><Button variant="outline" nativeButton={false} render={<Link href="/admin/clients" />}>Ver todos los clientes</Button><Button nativeButton={false} render={<Link href={`/admin/clients/${orgId}`} />}>Ir al expediente</Button></div>
          </section>
        )}
      </Main>
    </>
  );
}
