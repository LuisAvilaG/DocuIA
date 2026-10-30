"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, X, Trash2, Eye, EyeOff } from "lucide-react";
import { Panel, PanelTitle, Avatar, Kv, Pill, initials, PRODUCT_NAME, fmtDate, type Tone } from "./ui";
import { Field, TextInput, Select, DateInput, TimezoneSelect } from "./form";
import { Button } from "@/components/ui/button";
import { ClientLifecycleDialog } from "./client-lifecycle-dialog";

export interface ClientSummary {
  id: string; name: string; slug: string; status: string; suspensionReason: string | null; planId: string; timezone: string;
  billingEmail: string | null; createdAt: string; trialEndsAt: string | null; activeNsEnvironment: string; hasAiKey: boolean;
  products: string[]; users: { total: number; admins: number }; health: { label: string; tone: Tone };
}

const STATUS_LABEL: Record<string, string> = { active: "Activa", trial: "Trial", suspended: "Suspendida", churned: "Cancelada" };
const STATUS_TONE: Record<string, Tone> = { active: "ok", trial: "warn", suspended: "err", churned: "mute" };
const PLAN_LABEL: Record<string, string> = { starter: "Starter", growth: "Growth", enterprise: "Enterprise" };

/** The client's identity card: fixed on the left of every client tab. */
export function ClientPanel({ org, extra }: { org: ClientSummary; extra?: React.ReactNode }) {
  const [editing, setEditing] = useState(false);
  const [lifecycle, setLifecycle] = useState(false);
  const [now] = useState(() => Date.now());
  const trialDays = org.status === "trial" && org.trialEndsAt ? Math.ceil((new Date(org.trialEndsAt).getTime() - now) / 86_400_000) : null;

  return (
    <Panel>
      <PanelTitle
        eyebrow={<Link href="/admin/clients" className="hover:text-foreground">← Clientes</Link>}
        avatar={<Avatar text={initials(org.name)} />}
        title={org.name}
        subtitle={
          <span className="flex flex-wrap gap-1.5 mt-1">
            <Pill tone={STATUS_TONE[org.status] ?? "mute"}>{trialDays !== null ? (trialDays <= 0 ? "Trial vencido" : `Trial · ${trialDays} d`) : STATUS_LABEL[org.status] ?? org.status}</Pill>
            {org.health.tone !== "ok" && org.status !== "suspended" && <Pill tone={org.health.tone}>{org.health.label}</Pill>}
          </span>
        }
      />
      {org.status === "suspended" && org.suspensionReason && (
        <p className="text-xs text-muted-foreground -mt-4">Motivo: {org.suspensionReason}</p>
      )}
      <div>
        <Kv label="Slug">{org.slug}</Kv>
        <Kv label="Plan">{PLAN_LABEL[org.planId] ?? org.planId} · desde {fmtDate(org.createdAt)}</Kv>
        <Kv label="Productos">{org.products.length ? org.products.map((p) => PRODUCT_NAME[p] ?? p).join(" · ") : "ninguno"}</Kv>
        <Kv label="Zona horaria">{org.timezone}</Kv>
        <Kv label="Facturación">{org.billingEmail ?? "—"}</Kv>
        <Kv label="Usuarios">{org.users.total} · {org.users.admins} administrador{org.users.admins === 1 ? "" : "es"}</Kv>
        <Kv label="Entorno ERP">{org.activeNsEnvironment === "production" ? "Producción" : "Sandbox"}</Kv>
        <Kv label="Clave de IA">{org.hasAiKey ? "Propia" : "Global de la plataforma"}</Kv>
        {extra}
      </div>
      <div className="mt-auto flex flex-col gap-2">
        <Button variant="outline" onClick={() => setEditing(true)}>Editar datos</Button>
        <button type="button" onClick={() => setLifecycle(true)} className="text-xs text-muted-foreground hover:text-foreground text-center">
          {org.status === "suspended" ? "Restablecer o eliminar…" : "Suspender o eliminar…"}
        </button>
      </div>
      {editing && <EditClientDialog org={org} onClose={() => setEditing(false)} />}
      <ClientLifecycleDialog open={lifecycle} onClose={() => setLifecycle(false)} org={org} />
    </Panel>
  );
}

function EditClientDialog({ org, onClose }: { org: ClientSummary; onClose: () => void }) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: org.name, slug: org.slug, timezone: org.timezone, billingEmail: org.billingEmail ?? "", planId: org.planId,
    trialEndsAt: org.trialEndsAt ? org.trialEndsAt.slice(0, 10) : "",
  });
  const [aiKey, setAiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save(activate = false) {
    setBusy(true);
    setError("");
    try {
      const body: Record<string, unknown> = {};
      if (form.name !== org.name) body.name = form.name;
      if (form.slug !== org.slug) body.slug = form.slug;
      if (form.timezone !== org.timezone) body.timezone = form.timezone;
      if ((form.billingEmail || null) !== org.billingEmail) body.billingEmail = form.billingEmail || null;
      if (form.planId !== org.planId) body.planId = form.planId;
      const trialIso = form.trialEndsAt ? new Date(form.trialEndsAt + "T23:59:59Z").toISOString() : null;
      if (org.status === "trial" && !activate && trialIso !== org.trialEndsAt) body.trialEndsAt = trialIso;
      if (activate) body.status = "active";
      if (Object.keys(body).length) {
        const res = await fetch(`/api/admin/clients/${org.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { setError(data.error ?? "No se pudo guardar"); return; }
      }
      if (aiKey.trim()) {
        const res = await fetch(`/api/admin/clients/${org.id}/ai-config`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey: aiKey.trim() }) });
        if (!res.ok) { setError("Los datos se guardaron, pero la clave de IA no"); return; }
      }
      onClose();
      router.refresh();
    } catch {
      setError("No se pudo conectar al servidor");
    } finally {
      setBusy(false);
    }
  }

  async function clearAiKey() {
    setBusy(true);
    try {
      await fetch(`/api/admin/clients/${org.id}/ai-config`, { method: "DELETE" });
      onClose();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-14 overflow-y-auto" style={{ backgroundColor: "oklch(0.18 0.015 258 / 0.45)" }} onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div role="dialog" aria-modal="true" className="w-full max-w-[560px] bg-card rounded-2xl p-8 flex flex-col gap-5" style={{ boxShadow: "0 20px 60px oklch(0.18 0.015 258 / 0.18)" }}>
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-[20px] font-semibold tracking-[-0.02em]">Datos de la organización</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Nombre" className="col-span-2"><TextInput value={form.name} onChange={set("name")} /></Field>
          <Field label="Identificador"><TextInput value={form.slug} onChange={set("slug")} pattern="[a-z0-9-]+" spellCheck={false} /></Field>
          <Field label="Zona horaria"><TimezoneSelect value={form.timezone} onChange={(v) => setForm((f) => ({ ...f, timezone: v }))} /></Field>
          <Field label="Email de facturación" optional className="col-span-2"><TextInput type="email" value={form.billingEmail} onChange={set("billingEmail")} /></Field>
          <Field label="Plan">
            <Select value={form.planId} onChange={set("planId")}>
              <option value="starter">Starter</option><option value="growth">Growth</option><option value="enterprise">Enterprise</option>
            </Select>
          </Field>
          {org.status === "trial" && (
            <Field label="Fin del trial"><DateInput value={form.trialEndsAt} onChange={set("trialEndsAt")} /></Field>
          )}
        </div>
        <div className="border-t border-border pt-4">
          <p className="text-xs text-muted-foreground mb-1.5">Clave de IA propia (Gemini) · {org.hasAiKey ? "configurada, se guarda cifrada" : "usa la clave global de la plataforma"}</p>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <TextInput type={showKey ? "text" : "password"} value={aiKey} onChange={(e) => setAiKey(e.target.value)} placeholder={org.hasAiKey ? "Reemplazar clave…" : "AIza…"} autoComplete="off" className="pr-9" />
              <button type="button" onClick={() => setShowKey((v) => !v)} aria-label={showKey ? "Ocultar" : "Mostrar"} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground">{showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}</button>
            </div>
            {org.hasAiKey && <Button variant="ghost" onClick={clearAiKey} disabled={busy} className="text-destructive"><Trash2 /> Quitar</Button>}
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex items-center justify-between gap-3 pt-1">
          {org.status === "trial"
            ? <Button variant="outline" onClick={() => save(true)} disabled={busy}>Activar (termina el trial)</Button>
            : <span />}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>Cancelar</Button>
            <Button onClick={() => save(false)} disabled={busy}>{busy && <Loader2 className="animate-spin" />}Guardar</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
