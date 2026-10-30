"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Loader2, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Pill, SectionTitle, fmtDate, num, type Tone } from "@/components/admin/ui";
import { Select, control } from "@/components/admin/form";

export interface ConnectionRow {
  environment: "sandbox" | "production"; accountId: string; status: string; testedAt: string | null; error: string | null;
  scriptsInstalled: boolean; catalogScriptId: string | null; catalogDeployId: string | null; processScriptId: string | null; processDeployId: string | null; updatedAt: string;
}
export interface SubsidiaryRow {
  id: string; name: string; nsSubsidiaryId: string; currency: string; locale: string; taxId: string | null; isActive: boolean;
  items: number; vendors: number; locations: number;
}
type Env = "sandbox" | "production";
const ENV_LABEL: Record<Env, string> = { sandbox: "Sandbox", production: "Producción" };
const field = control;
const EMPTY_CREDS = { accountId: "", consumerKey: "", consumerSecret: "", tokenId: "", tokenSecret: "" };

function statusTone(c?: ConnectionRow): { tone: Tone; label: string } {
  if (!c) return { tone: "mute", label: "Sin credenciales" };
  if (c.status === "connected") return { tone: "ok", label: "Conectado" };
  if (c.status === "error") return { tone: "err", label: "Error" };
  return { tone: "warn", label: "Sin probar" };
}

export function ErpView({ orgId, activeEnvironment, connections, subsidiaries, hasAp, expenses }: {
  orgId: string; activeEnvironment: Env; connections: ConnectionRow[]; subsidiaries: SubsidiaryRow[]; hasAp: boolean;
  expenses: { categories: number; departments: number; classes: number; employees: number } | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: Tone; text: string } | null>(null);
  const [editEnv, setEditEnv] = useState<Env | null>(null);
  const [creds, setCreds] = useState(EMPTY_CREDS);
  const [scripts, setScripts] = useState({ catalogScriptId: "", catalogDeployId: "", processScriptId: "", processDeployId: "" });
  const [subEdit, setSubEdit] = useState<string | null>(null);
  const [subForm, setSubForm] = useState({ name: "", nsSubsidiaryId: "", currency: "MXN", locale: "es-MX", taxId: "", isActive: true });
  const [addingSub, setAddingSub] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const byEnv = (env: Env) => connections.find((c) => c.environment === env);
  const activeConn = byEnv(activeEnvironment);

  async function call(key: string, fn: () => Promise<Response>, okText: (d: Record<string, unknown>) => string) {
    setBusy(key);
    setMsg(null);
    try {
      const res = await fn();
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ tone: "err", text: (data.error as string) ?? "No se pudo completar la acción" }); return false; }
      setMsg({ tone: "ok", text: okText(data) });
      router.refresh();
      return true;
    } catch {
      setMsg({ tone: "err", text: "No se pudo conectar al servidor" });
      return false;
    } finally {
      setBusy(null);
    }
  }

  const test = (env: Env) => call(`test:${env}`, () => fetch(`/api/admin/clients/${orgId}/connection/test`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ environment: env }) }),
    (d) => `Conexión ${ENV_LABEL[env].toLowerCase()} correcta${d.scriptsOk === true ? ` · catálogo ${d.scriptVersion ?? "responde"}` : d.scriptsOk === false ? " · el script de catálogo no responde" : ""}.`);
  const activate = (env: Env) => call(`activate:${env}`, () => fetch(`/api/admin/clients/${orgId}/environment`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ environment: env }) }),
    () => `Los documentos ahora se envían a ${ENV_LABEL[env].toLowerCase()}.`);
  const openEdit = (env: Env) => {
    const c = byEnv(env);
    setEditEnv(env);
    setCreds({ ...EMPTY_CREDS, accountId: c?.accountId ?? "" });
    setScripts({ catalogScriptId: c?.catalogScriptId ?? "", catalogDeployId: c?.catalogDeployId ?? "", processScriptId: c?.processScriptId ?? "", processDeployId: c?.processDeployId ?? "" });
    setMsg(null);
  };
  const saveCreds = (testNow: boolean) => editEnv && call(`save:${editEnv}`, () => fetch(`/api/admin/clients/${orgId}/connection`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ environment: editEnv, ...creds, ...scripts, test: testNow }),
  }), (d) => d.tested ? "Credenciales guardadas y probadas." : "Credenciales guardadas sin probar.").then((ok) => { if (ok) { setEditEnv(null); setCreds(EMPTY_CREDS); } });
  const saveScripts = () => editEnv && call(`scripts:${editEnv}`, () => fetch(`/api/admin/clients/${orgId}/connection`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ environment: editEnv, catalogScriptId: scripts.catalogScriptId || null, catalogDeployId: scripts.catalogDeployId || null, processScriptId: scripts.processScriptId || null, processDeployId: scripts.processDeployId || null }),
  }), () => "Scripts guardados.");

  const syncSub = (id: string) => call(`sync:${id}`, () => fetch(`/api/admin/clients/${orgId}/sync`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subsidiaryId: id }) }),
    (d) => { const s = (d.summary ?? {}) as Record<string, number>; return `Catálogo sincronizado: ${Object.entries(s).map(([k, v]) => `${k} ${v}`).join(", ") || "sin cambios"}.`; });
  const saveSub = (id: string | null) => call(`sub:${id ?? "new"}`, () => id
    ? fetch(`/api/admin/clients/${orgId}/subsidiaries/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(subForm) })
    : fetch(`/api/admin/clients/${orgId}/subsidiaries`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subsidiaries: [subForm] }) }),
    () => id ? "Subsidiaria actualizada." : "Subsidiaria creada.").then((ok) => { if (ok) { setSubEdit(null); setAddingSub(false); } });
  const deleteSub = (id: string) => call(`del:${id}`, () => fetch(`/api/admin/clients/${orgId}/subsidiaries/${id}`, { method: "DELETE" }), () => "Subsidiaria eliminada con sus catálogos.").then(() => setConfirmDelete(null));
  const syncExpenses = (action: string) => call(`exp:${action}`, () => fetch(`/api/admin/clients/${orgId}/expenses`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) }),
    () => "Catálogos de gastos sincronizados.");

  return (
    <>
      <section>
        <h2 className="text-[24px] font-semibold tracking-[-0.02em]">
          {activeConn?.status === "connected"
            ? <>Los documentos se envían a <span className="text-primary">{ENV_LABEL[activeEnvironment].toLowerCase()}</span>.</>
            : <>El entorno activo ({ENV_LABEL[activeEnvironment].toLowerCase()}) <span className="text-[oklch(0.50_0.14_80)]">no está conectado</span>.</>}
        </h2>
        <p className="text-[15px] text-muted-foreground mt-2 max-w-[58ch]">Un entorno solo puede activarse después de una prueba exitosa de sus credenciales. Guardar sin probar lo deja en &ldquo;sin probar&rdquo;.</p>
      </section>

      {msg && <p className={cn("text-sm -mt-6", msg.tone === "err" ? "text-destructive" : "text-success")}>{msg.text}</p>}

      <div className="grid grid-cols-2 gap-5">
        {(["sandbox", "production"] as Env[]).map((env) => {
          const c = byEnv(env);
          const st = statusTone(c);
          const isActive = activeEnvironment === env;
          const canActivate = c?.status === "connected" && !isActive;
          return (
            <section key={env} className={cn("rounded-xl border bg-card p-5 flex flex-col gap-3.5", isActive ? "border-primary shadow-[0_0_0_3px_oklch(0.48_0.15_182_/_0.08)]" : "border-border")}>
              <div className="flex items-center justify-between gap-3">
                <div><div className="font-semibold text-[15px]">{ENV_LABEL[env]}</div><div className="text-xs text-muted-foreground tabular-nums">{c?.accountId ?? "sin cuenta"}</div></div>
                <div className="flex gap-1.5">{isActive && <Pill tone="info">Activo</Pill>}<Pill tone={st.tone}>{st.label}</Pill></div>
              </div>
              <ul className="text-[13px] flex flex-col gap-2">
                <Step ok={Boolean(c)} now={!c}>{c ? `Credenciales guardadas el ${fmtDate(c.updatedAt)}` : "Guardar credenciales"}</Step>
                <Step ok={c?.status === "connected"} now={Boolean(c) && c!.status !== "connected"}>{c?.status === "connected" ? `Probadas el ${fmtDate(c.testedAt)}` : c?.status === "error" ? `Falló: ${c.error ?? "error"}` : "Probar la conexión"}</Step>
                {hasAp && <Step ok={Boolean(c?.catalogScriptId)} now={c?.status === "connected" && !c.catalogScriptId}>{c?.catalogScriptId ? `Scripts: catálogo${c.processScriptId ? " y proceso" : ""}${c.scriptsInstalled ? " verificados" : ""}` : "Configurar scripts"}</Step>}
                <Step ok={isActive} now={canActivate}>{isActive ? "Entorno activo para documentos" : "Activar como entorno de documentos"}</Step>
              </ul>
              <div className="flex flex-wrap gap-2 mt-1">
                {c && <Button size="sm" variant={c.status === "connected" ? "outline" : "default"} disabled={busy !== null} onClick={() => test(env)}>{busy === `test:${env}` && <Loader2 className="animate-spin" />}{c.status === "connected" ? "Volver a probar" : "Probar conexión"}</Button>}
                {canActivate && <Button size="sm" disabled={busy !== null} onClick={() => activate(env)}>{busy === `activate:${env}` && <Loader2 className="animate-spin" />}Activar {ENV_LABEL[env].toLowerCase()}</Button>}
                <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => (editEnv === env ? setEditEnv(null) : openEdit(env))}>{c ? "Credenciales y scripts" : "Agregar credenciales"}</Button>
              </div>
            </section>
          );
        })}
      </div>

      {editEnv && (
        <section className="border-t border-foreground pt-5 flex flex-col gap-5">
          <div className="flex items-baseline justify-between"><h3 className="text-[13px] font-semibold">Credenciales de {ENV_LABEL[editEnv].toLowerCase()}</h3><span className="text-xs text-muted-foreground">se guardan cifradas · nunca se muestran de nuevo</span></div>
          <div className="grid grid-cols-2 gap-4 max-w-[680px]">
            <label className="col-span-2 max-w-[320px] text-xs text-muted-foreground flex flex-col gap-1">ID de cuenta{editEnv === "sandbox" ? " (termina en _SB1)" : ""}<input className={field} value={creds.accountId} onChange={(e) => setCreds({ ...creds, accountId: e.target.value })} /></label>
            {(["consumerKey", "consumerSecret", "tokenId", "tokenSecret"] as const).map((k) => (
              <label key={k} className="text-xs text-muted-foreground flex flex-col gap-1">{{ consumerKey: "Consumer key", consumerSecret: "Consumer secret", tokenId: "Token ID", tokenSecret: "Token secret" }[k]}
                <input className={field} type="password" autoComplete="off" value={creds[k]} onChange={(e) => setCreds({ ...creds, [k]: e.target.value })} /></label>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button disabled={busy !== null || Object.values(creds).some((v) => !v.trim())} onClick={() => saveCreds(true)}>{busy === `save:${editEnv}` && <Loader2 className="animate-spin" />}Guardar y probar</Button>
            <Button variant="outline" disabled={busy !== null || Object.values(creds).some((v) => !v.trim())} onClick={() => saveCreds(false)}>Guardar sin probar</Button>
            <Button variant="ghost" onClick={() => setEditEnv(null)}>Cancelar</Button>
          </div>
          {hasAp && (
            <>
              <div className="flex items-baseline justify-between border-t border-border pt-4"><h3 className="text-[13px] font-semibold">Scripts del ERP en {ENV_LABEL[editEnv].toLowerCase()}</h3><a href="/api/scripts/netsuite/docuia-catalog-v1.js" className="text-xs text-primary" download>Descargar scripts ↓</a></div>
              <div className="grid grid-cols-2 gap-4 max-w-[680px]">
                {([["catalogScriptId", "Catálogo · Script ID"], ["catalogDeployId", "Catálogo · Deploy ID"], ["processScriptId", "Proceso · Script ID"], ["processDeployId", "Proceso · Deploy ID"]] as const).map(([k, l]) => (
                  <label key={k} className="text-xs text-muted-foreground flex flex-col gap-1">{l}<input className={cn(field, "font-mono text-xs")} value={scripts[k]} onChange={(e) => setScripts({ ...scripts, [k]: e.target.value })} placeholder={k.startsWith("catalog") ? (k.endsWith("ScriptId") ? "customscript_docuia_catalog" : "customdeploy_docuia_catalog") : (k.endsWith("ScriptId") ? "customscript_docuia_process" : "customdeploy_docuia_process")} /></label>
                ))}
              </div>
              <div><Button variant="outline" disabled={busy !== null || !byEnv(editEnv)} onClick={saveScripts}>{busy === `scripts:${editEnv}` && <Loader2 className="animate-spin" />}Guardar scripts</Button>{!byEnv(editEnv) && <span className="text-xs text-muted-foreground ml-3">Guarda primero las credenciales.</span>}</div>
            </>
          )}
        </section>
      )}

      {hasAp && (
        <section>
          <SectionTitle aside={<button type="button" className="text-primary" onClick={() => { setAddingSub(true); setSubForm({ name: "", nsSubsidiaryId: "", currency: "MXN", locale: "es-MX", taxId: "", isActive: true }); }}>Agregar subsidiaria</button>}>
            Subsidiarias y catálogo
          </SectionTitle>
          {subsidiaries.length === 0 && !addingSub && <p className="text-sm text-muted-foreground mt-4">Sin subsidiarias. Agrega las que DocuIA debe gestionar en el ERP.</p>}
          <ul className="divide-y divide-border/70">
            {addingSub && (
              <li className="py-4"><SubForm form={subForm} setForm={setSubForm} isNew busy={busy === "sub:new"} onSave={() => saveSub(null)} onCancel={() => setAddingSub(false)} /></li>
            )}
            {subsidiaries.map((s) => (
              <li key={s.id} className="py-4">
                {subEdit === s.id ? (
                  <SubForm form={subForm} setForm={setSubForm} busy={busy === `sub:${s.id}`} onSave={() => saveSub(s.id)} onCancel={() => setSubEdit(null)} />
                ) : (
                  <div className="flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium">{s.name} {!s.isActive && <Pill tone="mute" className="ml-1">Inactiva</Pill>}</div>
                      <div className="text-xs text-muted-foreground tabular-nums">ID ERP {s.nsSubsidiaryId} · {s.currency}{s.taxId ? ` · RFC ${s.taxId}` : ""} · {num(s.items)} ítems · {num(s.vendors)} proveedores · {num(s.locations)} ubicaciones</div>
                    </div>
                    <Button size="sm" variant="outline" disabled={busy !== null || activeConn?.status !== "connected"} onClick={() => syncSub(s.id)} title={activeConn?.status !== "connected" ? "El entorno activo no está conectado" : ""}>
                      {busy === `sync:${s.id}` ? <Loader2 className="animate-spin" /> : <RefreshCw />} Sincronizar
                    </Button>
                    <button type="button" className="text-xs text-primary" onClick={() => { setSubEdit(s.id); setSubForm({ name: s.name, nsSubsidiaryId: s.nsSubsidiaryId, currency: s.currency, locale: s.locale, taxId: s.taxId ?? "", isActive: s.isActive }); }}>Editar</button>
                    {confirmDelete === s.id ? (
                      <span className="flex items-center gap-1.5 text-xs"><button type="button" className="text-destructive font-medium" onClick={() => deleteSub(s.id)} disabled={busy !== null}>Confirmar</button><button type="button" className="text-muted-foreground" onClick={() => setConfirmDelete(null)}>Cancelar</button></span>
                    ) : (
                      <button type="button" className="text-muted-foreground hover:text-destructive" aria-label={`Eliminar ${s.name}`} onClick={() => setConfirmDelete(s.id)}><Trash2 className="w-3.5 h-3.5" /></button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {expenses && (
        <section>
          <SectionTitle aside="requiere el entorno activo conectado">Catálogos de gastos</SectionTitle>
          <p className="text-[13px] text-muted-foreground mt-3">{num(expenses.categories)} categorías · {num(expenses.departments)} departamentos · {num(expenses.classes)} clases · {num(expenses.employees)} empleados con acceso de gastos.</p>
          <div className="flex flex-wrap gap-2 mt-3">
            {[["sync_categories", "Categorías"], ["sync_departments", "Departamentos"], ["sync_classes", "Clases"], ["sync_employees", "Empleados"], ["sync_all", "Todo"]].map(([a, l]) => (
              <Button key={a} size="sm" variant={a === "sync_all" ? "default" : "outline"} disabled={busy !== null || activeConn?.status !== "connected"} onClick={() => syncExpenses(a)}>
                {busy === `exp:${a}` ? <Loader2 className="animate-spin" /> : <RefreshCw />} {l}
              </Button>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function Step({ ok, now, children }: { ok: boolean; now?: boolean; children: React.ReactNode }) {
  return (
    <li className={cn("flex items-center gap-3", !ok && !now && "text-muted-foreground")}>
      <span className={cn("w-[22px] h-[22px] rounded-full inline-flex items-center justify-center text-[11px] font-semibold shrink-0", ok ? "bg-success/10 text-success" : now ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground")}>{ok ? "✓" : "·"}</span>
      <span>{children}</span>
    </li>
  );
}

function SubForm({ form, setForm, isNew = false, busy, onSave, onCancel }: {
  form: { name: string; nsSubsidiaryId: string; currency: string; locale: string; taxId: string; isActive: boolean };
  setForm: (f: typeof form) => void; isNew?: boolean; busy: boolean; onSave: () => void; onCancel: () => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-3">
        <label className="text-xs text-muted-foreground flex flex-col gap-1">Nombre<input className={field} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <label className="text-xs text-muted-foreground flex flex-col gap-1">ID de subsidiaria en el ERP<input className={field} value={form.nsSubsidiaryId} onChange={(e) => setForm({ ...form, nsSubsidiaryId: e.target.value })} /></label>
        <label className="text-xs text-muted-foreground flex flex-col gap-1">Moneda<input className={field} maxLength={3} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} /></label>
        <label className="text-xs text-muted-foreground flex flex-col gap-1">RFC / Tax ID<input className={field} maxLength={20} value={form.taxId} onChange={(e) => setForm({ ...form, taxId: e.target.value.toUpperCase() })} /></label>
        <label className="text-xs text-muted-foreground flex flex-col gap-1">Locale<input className={field} value={form.locale} onChange={(e) => setForm({ ...form, locale: e.target.value })} /></label>
        {!isNew && (
          <label className="text-xs text-muted-foreground flex flex-col gap-1">Estado
            <Select value={form.isActive ? "1" : "0"} onChange={(e) => setForm({ ...form, isActive: e.target.value === "1" })}><option value="1">Activa</option><option value="0">Inactiva</option></Select>
          </label>
        )}
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={onSave} disabled={busy || !form.name.trim() || !form.nsSubsidiaryId.trim()}>{busy && <Loader2 className="animate-spin" />}{isNew ? "Crear" : "Guardar"}</Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>Cancelar</Button>
      </div>
    </div>
  );
}
