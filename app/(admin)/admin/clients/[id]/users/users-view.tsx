"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UserPlus } from "lucide-react";
import { TENANT_ROLES, TENANT_ROLE_LABELS, type TenantRole } from "@/lib/auth/permissions";
import { Button } from "@/components/ui/button";
import { Pill, SectionTitle, relativeTime, fmtDate } from "@/components/admin/ui";
import { Select, control } from "@/components/admin/form";

export interface UserRow { id: string; email: string; fullName: string | null; role: string; isActive: boolean; lastLoginAt: string | null; createdAt: string }

const field = control;

export function UsersView({ orgId, users }: { orgId: string; users: UserRow[] }) {
  const router = useRouter();
  const [creating, setCreating] = useState(users.length === 0);
  const [form, setForm] = useState({ email: "", fullName: "", role: "operator" as TenantRole, password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [edit, setEdit] = useState({ role: "operator", isActive: true, password: "" });

  async function create() {
    setBusy(true); setError("");
    try {
      const res = await fetch(`/api/admin/clients/${orgId}/users`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.email.trim(), fullName: form.fullName.trim() || null, role: form.role, password: form.password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "No se pudo crear el usuario"); return; }
      setForm({ email: "", fullName: "", role: "operator", password: "" });
      setCreating(false);
      router.refresh();
    } catch { setError("No se pudo conectar al servidor"); } finally { setBusy(false); }
  }

  async function save(userId: string) {
    setBusy(true); setError("");
    try {
      const body: Record<string, unknown> = { role: edit.role, isActive: edit.isActive };
      if (edit.password) body.password = edit.password;
      const res = await fetch(`/api/admin/clients/${orgId}/users/${userId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "No se pudo guardar"); return; }
      setEditing(null);
      router.refresh();
    } catch { setError("No se pudo conectar al servidor"); } finally { setBusy(false); }
  }

  return (
    <>
      <div className="flex items-end justify-between gap-4 -mb-4">
        <div>
          <h2 className="text-[22px] font-semibold tracking-[-0.02em]">{users.length === 0 ? "Nadie puede entrar todavía." : `${users.length} persona${users.length === 1 ? "" : "s"} con acceso al portal.`}</h2>
          <p className="text-[15px] text-muted-foreground mt-1.5">Las contraseñas se comparten por un canal seguro; el usuario puede cambiarla desde su perfil.</p>
        </div>
        {!creating && <Button onClick={() => setCreating(true)}><UserPlus /> Nuevo usuario</Button>}
      </div>

      {creating && (
        <section className="rounded-xl border border-border bg-card p-5 flex flex-col gap-4">
          <SectionTitle>Nuevo usuario</SectionTitle>
          <div className="grid grid-cols-2 gap-4">
            <label className="text-xs text-muted-foreground flex flex-col gap-1">Email<input className={field} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="usuario@empresa.com" /></label>
            <label className="text-xs text-muted-foreground flex flex-col gap-1">Nombre completo<input className={field} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></label>
            <label className="text-xs text-muted-foreground flex flex-col gap-1">Contraseña inicial<input className={field} type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Mínimo 8 caracteres" /></label>
            <label className="text-xs text-muted-foreground flex flex-col gap-1">Rol
              <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as TenantRole })}>
                {TENANT_ROLES.map((r) => <option key={r} value={r}>{TENANT_ROLE_LABELS[r]}</option>)}
              </Select>
            </label>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button onClick={create} disabled={busy || !form.email.trim() || form.password.length < 8}>{busy && <Loader2 className="animate-spin" />}Crear usuario</Button>
            {users.length > 0 && <Button variant="ghost" onClick={() => setCreating(false)} disabled={busy}>Cancelar</Button>}
          </div>
        </section>
      )}

      {users.length > 0 && (
        <section>
          <div className="grid grid-cols-[minmax(0,1fr)_150px_120px_100px_70px] gap-4 border-b border-foreground pb-2 text-[11px] font-medium tracking-[0.06em] uppercase text-muted-foreground">
            <span>Usuario</span><span>Rol</span><span>Último acceso</span><span>Estado</span><span />
          </div>
          <ul className="divide-y divide-border/70">
            {users.map((u) => (
              <li key={u.id} className="py-3.5">
                <div className="grid grid-cols-[minmax(0,1fr)_150px_120px_100px_70px] gap-4 items-center text-sm">
                  <div className="min-w-0"><div className="font-medium truncate">{u.fullName || u.email}</div><div className="text-xs text-muted-foreground truncate">{u.email} · desde {fmtDate(u.createdAt)}</div></div>
                  <span className="text-[13px]">{TENANT_ROLE_LABELS[u.role as TenantRole] ?? u.role}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{relativeTime(u.lastLoginAt)}</span>
                  <Pill tone={u.isActive ? "ok" : "mute"}>{u.isActive ? "Activo" : "Inactivo"}</Pill>
                  <button type="button" className="text-xs text-primary text-right" onClick={() => { setEditing(editing === u.id ? null : u.id); setEdit({ role: u.role, isActive: u.isActive, password: "" }); setError(""); }}>
                    {editing === u.id ? "Cerrar" : "Editar"}
                  </button>
                </div>
                {editing === u.id && (
                  <div className="mt-4 rounded-xl border border-border bg-card p-4 grid grid-cols-3 gap-4 items-end">
                    <label className="text-xs text-muted-foreground flex flex-col gap-1">Rol
                      <Select value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })}>
                        {TENANT_ROLES.map((r) => <option key={r} value={r}>{TENANT_ROLE_LABELS[r]}</option>)}
                      </Select>
                    </label>
                    <label className="text-xs text-muted-foreground flex flex-col gap-1">Acceso
                      <Select value={edit.isActive ? "1" : "0"} onChange={(e) => setEdit({ ...edit, isActive: e.target.value === "1" })}>
                        <option value="1">Activo</option><option value="0">Inactivo (cierra sus sesiones)</option>
                      </Select>
                    </label>
                    <label className="text-xs text-muted-foreground flex flex-col gap-1">Nueva contraseña<input className={field} type="password" autoComplete="new-password" value={edit.password} onChange={(e) => setEdit({ ...edit, password: e.target.value })} placeholder="Dejar vacío para no cambiar" /></label>
                    {error && <p className="col-span-3 text-sm text-destructive">{error}</p>}
                    <div className="col-span-3 flex gap-2">
                      <Button size="sm" onClick={() => save(u.id)} disabled={busy || (edit.password.length > 0 && edit.password.length < 8)}>{busy && <Loader2 className="animate-spin" />}Guardar</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(null)} disabled={busy}>Cancelar</Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
