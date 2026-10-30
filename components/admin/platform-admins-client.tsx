"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { control } from "@/components/admin/form";
import { Panel, PanelTitle, Main, Pill, initials, relativeTime, fmtDate, Label } from "./ui";

interface Admin { id: string; email: string; fullName: string | null; isActive: boolean; lastLoginAt: string | null; createdAt: string }

const field = control;

export function PlatformAdminsClient({ admins, currentAdminId }: { admins: Admin[]; currentAdminId: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<{ kind: "new" } | { kind: "edit"; id: string } | null>(null);
  const [form, setForm] = useState({ fullName: "", email: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const editing = mode?.kind === "edit" ? admins.find((a) => a.id === mode.id) ?? null : null;
  const active = admins.filter((a) => a.isActive).length;

  function startNew() { setMode({ kind: "new" }); setForm({ fullName: "", email: "", password: "" }); setError(""); }
  function startEdit(a: Admin) { setMode({ kind: "edit", id: a.id }); setForm({ fullName: a.fullName ?? "", email: a.email, password: "" }); setError(""); }

  async function save(extra: Record<string, unknown> = {}) {
    setBusy(true); setError("");
    try {
      const res = mode?.kind === "new"
        ? await fetch("/api/admin/platform-admins", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) })
        : await fetch(`/api/admin/platform-admins/${editing!.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fullName: form.fullName, ...(form.password ? { password: form.password } : {}), ...extra }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "No se pudo guardar"); return; }
      if (data.reauthenticate) { await fetch("/api/admin/auth/logout", { method: "POST" }); router.push("/admin/login"); return; }
      setMode(null);
      router.refresh();
    } catch { setError("No se pudo conectar al servidor"); } finally { setBusy(false); }
  }

  return (
    <>
      <Panel>
        {mode ? (
          <>
            <PanelTitle eyebrow={<Label>{mode.kind === "new" ? "Nuevo administrador" : "Editando"}</Label>}
              avatar={<div className="w-14 h-14 rounded-2xl bg-secondary text-foreground/80 flex items-center justify-center text-[20px] font-bold">{mode.kind === "new" ? "+" : initials(editing?.fullName || editing?.email || "?")}</div>}
              title={mode.kind === "new" ? "Nuevo administrador" : editing?.fullName || editing?.email}
              subtitle={mode.kind === "edit" ? `${editing?.email} · desde ${fmtDate(editing?.createdAt)}` : "Comparte la contraseña por un canal seguro."} />
            <div className="flex flex-col gap-3.5">
              <label className="text-xs text-muted-foreground flex flex-col gap-1">Nombre completo<input className={field} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></label>
              <label className="text-xs text-muted-foreground flex flex-col gap-1">Email<input className={cn(field, mode.kind === "edit" && "bg-secondary text-muted-foreground")} type="email" value={form.email} disabled={mode.kind === "edit"} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
              <label className="text-xs text-muted-foreground flex flex-col gap-1">{mode.kind === "new" ? "Contraseña temporal" : "Restablecer contraseña"}
                <input className={field} type="password" autoComplete="new-password" minLength={12} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder={mode.kind === "new" ? "Mínimo 12 caracteres" : "Mínimo 12 · cierra sus sesiones"} /></label>
            </div>
            {mode.kind === "edit" && editing && (
              <div className="flex items-center justify-between gap-3 border-y border-border/60 py-3">
                <div><div className="text-[13px] font-medium">Acceso al panel</div><div className="text-xs text-muted-foreground">Al desactivar se revocan sus sesiones.</div></div>
                <Button size="sm" variant="outline" disabled={busy || editing.id === currentAdminId || (editing.isActive && active <= 1)} onClick={() => save({ isActive: !editing.isActive })}>{editing.isActive ? "Desactivar" : "Activar"}</Button>
              </div>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="mt-auto flex gap-2">
              <Button className="flex-1" disabled={busy || (mode.kind === "new" && (!form.email || form.password.length < 12)) || (form.password.length > 0 && form.password.length < 12)} onClick={() => save()}>{busy && <Loader2 className="animate-spin" />}{mode.kind === "new" ? "Crear" : "Guardar"}</Button>
              <Button variant="ghost" onClick={() => setMode(null)} disabled={busy}>Cancelar</Button>
            </div>
          </>
        ) : (
          <>
            <PanelTitle title="Administradores" subtitle={`${admins.length} cuenta${admins.length === 1 ? "" : "s"} · ${active} activa${active === 1 ? "" : "s"}`} />
            <p className="text-[13px] text-muted-foreground leading-relaxed">Quien aparece aquí puede entrar a todo el panel de plataforma. Las contraseñas se comparten por un canal seguro y no se vuelven a mostrar.</p>
            <div className="mt-auto"><Button className="w-full" onClick={startNew}>Nuevo administrador</Button></div>
          </>
        )}
      </Panel>

      <Main>
        <div className="grid grid-cols-[36px_minmax(0,1fr)_150px_100px_60px] gap-4 border-b border-foreground pb-2 text-[11px] font-medium tracking-[0.06em] uppercase text-muted-foreground"><span /><span>Cuenta</span><span>Último acceso</span><span>Estado</span><span /></div>
        <ul className="divide-y divide-border/70 -mt-10">
          {admins.map((a) => (
            <li key={a.id} className={cn("grid grid-cols-[36px_minmax(0,1fr)_150px_100px_60px] gap-4 items-center py-4 -mx-3 px-3 rounded-xl", editing?.id === a.id && "bg-card", !a.isActive && "text-muted-foreground")}>
              <span className={cn("w-9 h-9 rounded-full bg-secondary text-foreground/80 inline-flex items-center justify-center text-xs font-semibold", !a.isActive && "opacity-60")}>{initials(a.fullName || a.email)}</span>
              <div className="min-w-0"><div className="font-semibold flex items-center gap-2">{a.fullName || a.email}{a.id === currentAdminId && <Pill tone="info">Tú</Pill>}</div><div className="text-xs text-muted-foreground truncate">{a.email} · desde {fmtDate(a.createdAt)}</div></div>
              <span className="text-xs text-muted-foreground tabular-nums">{relativeTime(a.lastLoginAt)}</span>
              <Pill tone={a.isActive ? "ok" : "mute"}>{a.isActive ? "Activo" : "Inactivo"}</Pill>
              <button type="button" className="text-xs text-primary text-right" onClick={() => (editing?.id === a.id ? setMode(null) : startEdit(a))}>{editing?.id === a.id ? "Cerrar" : "Editar"}</button>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground -mt-4">Siempre debe quedar al menos un administrador activo. No puedes desactivar tu propia cuenta.</p>
      </Main>
    </>
  );
}
