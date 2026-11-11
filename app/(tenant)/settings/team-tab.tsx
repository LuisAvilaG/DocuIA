"use client";

// Equipo (rediseño): quién entra y qué puede hacer. Invitar y editar se abren
// en un panel lateral; el rol se elige leyendo qué permite.
import { useMemo, useState } from "react";
import { CheckCircle2, Copy, Loader2, Search, UserPlus } from "lucide-react";
import { btn, Drawer, Notice, StatusPill } from "@/components/kit";
import { TENANT_ROLE_LABELS, type TenantRole } from "@/lib/auth/permissions";

export type TeamUser = { id: string; email: string; fullName: string | null; role: string; isActive: boolean; lastLoginAt: string | null; createdAt: string };

const ROLE_HELP: Record<TenantRole, string> = {
  admin: "Todo, incluidos flujos, usuarios y configuración.",
  approver: "Revisa documentos y casos, y los aprueba o rechaza.",
  operator: "Sube documentos, crea casos y corrige datos. No aprueba.",
  viewer: "Ve documentos y casos, sin cambiar nada.",
  accountant: "Revisa, aprueba y envía al ERP los informes de gastos. Ve las facturas.",
  expense_submitter: "Solo registra sus propios gastos.",
};
const BASE_ROLES: TenantRole[] = ["admin", "approver", "operator", "viewer"];
const EXPENSE_ROLES: TenantRole[] = ["accountant", "expense_submitter"];

const inp = "w-full rounded-md border border-border bg-background px-3 py-2 text-[13.5px] outline-none focus:border-primary";

function initials(u: TeamUser) {
  const base = (u.fullName || u.email).trim();
  const parts = base.split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}
function lastAccess(iso: string | null) {
  if (!iso) return "Nunca ha ingresado";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 2) return "Ahora";
  if (min < 60) return `Hace ${min} min`;
  if (min < 24 * 60) return `Hace ${Math.round(min / 60)} h`;
  if (min < 48 * 60) return "Ayer";
  return new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}
const state = (u: TeamUser) => (!u.isActive ? "inactive" : u.lastLoginAt ? "active" : "invited");
const STATE = { active: { label: "Activo", tone: "ok" }, invited: { label: "Invitado", tone: "blue" }, inactive: { label: "Inactivo", tone: "mute" } } as const;

function RolePicker({ roles, value, onChange, name }: { roles: TenantRole[]; value: string; onChange: (r: TenantRole) => void; name: string }) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1 text-[13px] font-semibold">Rol</legend>
      {roles.map((r) => (
        <label key={r} className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 text-[13px] ${value === r ? "border-primary bg-primary/5" : "border-border hover:bg-secondary/50"}`}>
          <input type="radio" name={name} checked={value === r} onChange={() => onChange(r)} className="mt-0.5" />
          <span><b className="font-semibold">{TENANT_ROLE_LABELS[r]}</b><span className="block text-xs text-muted-foreground">{ROLE_HELP[r]}</span></span>
        </label>
      ))}
    </fieldset>
  );
}

function TempPassword({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[13px]">{label}</p>
      <div className="flex items-center gap-2 rounded-lg border border-border bg-secondary/60 px-3 py-2.5">
        <code className="flex-1 font-mono text-sm tracking-widest">{value}</code>
        <button type="button" aria-label="Copiar contraseña" onClick={() => { void navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
          className="text-muted-foreground hover:text-foreground">{copied ? <CheckCircle2 className="size-4 text-tone-ok" /> : <Copy className="size-4" />}</button>
      </div>
    </div>
  );
}

export function TeamTab({ users, setUsers, isAdmin, currentUserId, expenseEnabled }: {
  users: TeamUser[];
  setUsers: React.Dispatch<React.SetStateAction<TeamUser[]>>;
  isAdmin: boolean;
  currentUserId: string;
  expenseEnabled: boolean;
}) {
  const roles = expenseEnabled ? [...BASE_ROLES, ...EXPENSE_ROLES] : BASE_ROLES;
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [panel, setPanel] = useState<null | { kind: "invite" } | { kind: "edit"; id: string }>(null);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return users.filter((u) => (!needle || `${u.fullName ?? ""} ${u.email}`.toLowerCase().includes(needle))
      && (!roleFilter || u.role === roleFilter) && (!stateFilter || (stateFilter === "active" ? u.isActive : !u.isActive)));
  }, [users, q, roleFilter, stateFilter]);
  const activeCount = users.filter((u) => u.isActive).length;
  const editing = panel?.kind === "edit" ? users.find((u) => u.id === panel.id) ?? null : null;

  return (
    <div className="grid max-w-[1100px] gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
      <section className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold tracking-[-0.02em]">Usuarios</h2>
            <p className="text-[13px] text-muted-foreground">Quién entra a DocuIA y qué puede hacer.</p>
          </div>
          {isAdmin && <button type="button" onClick={() => setPanel({ kind: "invite" })} className={btn("primary")}><UserPlus /> Invitar usuario</button>}
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="relative min-w-[200px] flex-1">
            <span className="sr-only">Buscar</span>
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre o correo" className={`${inp} pl-9`} />
          </label>
          <select aria-label="Rol" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className={`${inp} w-auto`}>
            <option value="">Todos los roles</option>
            {roles.map((r) => <option key={r} value={r}>{TENANT_ROLE_LABELS[r]}</option>)}
          </select>
          <select aria-label="Estado" value={stateFilter} onChange={(e) => setStateFilter(e.target.value)} className={`${inp} w-auto`}>
            <option value="">Activos e inactivos</option>
            <option value="active">Activos</option>
            <option value="inactive">Inactivos</option>
          </select>
        </div>
        <div className="overflow-x-auto rounded-[10px] border border-border bg-card">
          <table className="w-full text-[13.5px]">
            <thead><tr className="border-b border-border text-left text-xs text-muted-foreground"><th className="px-4 py-2.5 font-medium">Persona</th><th className="px-3 py-2.5 font-medium">Rol</th><th className="px-3 py-2.5 font-medium">Estado</th><th className="px-3 py-2.5 font-medium">Último acceso</th>{isAdmin && <th className="px-4 py-2.5"><span className="sr-only">Acciones</span></th>}</tr></thead>
            <tbody>
              {shown.map((u) => {
                const st = STATE[state(u)];
                return (
                  <tr key={u.id} className="border-b border-line-soft last:border-0">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] font-semibold">{initials(u)}</span>
                        <span className="min-w-0"><b className="block truncate font-semibold">{u.fullName ?? u.email}{u.id === currentUserId && <span className="font-normal text-muted-foreground"> · tú</span>}</b>{u.fullName && <span className="block truncate text-xs text-muted-foreground">{u.email}</span>}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3">{TENANT_ROLE_LABELS[u.role as TenantRole] ?? u.role}</td>
                    <td className="px-3 py-3"><StatusPill tone={st.tone}>{st.label}</StatusPill></td>
                    <td className="px-3 py-3 text-muted-foreground">{lastAccess(u.lastLoginAt)}</td>
                    {isAdmin && <td className="px-4 py-3 text-right">{u.id !== currentUserId && <button type="button" onClick={() => setPanel({ kind: "edit", id: u.id })} className="text-[13px] font-semibold text-link hover:underline">Editar</button>}</td>}
                  </tr>
                );
              })}
              {shown.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-[13px] text-muted-foreground">Nadie coincide con la búsqueda.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">{users.length} usuario{users.length === 1 ? "" : "s"} · {activeCount} activo{activeCount === 1 ? "" : "s"}.</p>
      </section>

      <aside className="flex flex-col gap-3 self-start rounded-[10px] border border-border bg-card p-4">
        <h3 className="text-[13px] font-semibold">Qué puede hacer cada rol</h3>
        <dl className="flex flex-col gap-2.5 text-[13px]">
          {roles.map((r) => <div key={r}><dt className="font-semibold">{TENANT_ROLE_LABELS[r]}</dt><dd className="text-muted-foreground">{ROLE_HELP[r]}</dd></div>)}
        </dl>
      </aside>

      {panel?.kind === "invite" && <InviteDrawer roles={roles} onClose={() => setPanel(null)} onCreated={(u) => setUsers((prev) => [...prev, u])} />}
      {editing && <EditDrawer user={editing} roles={roles} onClose={() => setPanel(null)} onSaved={(u) => setUsers((prev) => prev.map((x) => (x.id === u.id ? u : x)))} />}
    </div>
  );
}

function InviteDrawer({ roles, onClose, onCreated }: { roles: TenantRole[]; onClose: () => void; onCreated: (u: TeamUser) => void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<TenantRole>("operator");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [temp, setTemp] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/v1/team", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, fullName: name, role }) });
      const d = await res.json();
      if (!res.ok) { setError(d.error ?? "No se pudo crear el usuario"); return; }
      setTemp(d.tempPassword);
      onCreated({ id: d.userId, email: email.toLowerCase().trim(), fullName: name.trim() || null, role, isActive: true, lastLoginAt: null, createdAt: new Date().toISOString() });
    } catch { setError("Sin conexión"); } finally { setBusy(false); }
  }

  return (
    <Drawer title="Invitar usuario" description="Creamos su cuenta con una contraseña temporal que le compartes tú." onClose={onClose} locked={busy} width={480}
      footer={temp ? <button type="button" onClick={onClose} className={btn("primary")}>Listo</button> : <>
        <button type="button" onClick={onClose} className={btn("secondary")}>Cancelar</button>
        <button type="submit" form="invite-form" disabled={busy} className={btn("primary")}>{busy && <Loader2 className="animate-spin" />} Crear usuario</button>
      </>}>
      {temp ? (
        <div className="flex flex-col gap-3">
          <Notice tone="ok" title="Usuario creado">También le enviamos un correo de invitación.</Notice>
          <TempPassword value={temp} label="Contraseña temporal. La cambiará al entrar por primera vez:" />
        </div>
      ) : (
        <form id="invite-form" onSubmit={submit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5"><span className="text-[13px] font-semibold">Correo</span><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nombre@empresa.com" className={inp} /></label>
          <label className="flex flex-col gap-1.5"><span className="text-[13px] font-semibold">Nombre</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre y apellido" className={inp} /></label>
          <RolePicker roles={roles} value={role} onChange={setRole} name="invite-role" />
          {error && <Notice tone="err" title={error} />}
        </form>
      )}
    </Drawer>
  );
}

function EditDrawer({ user, roles, onClose, onSaved }: { user: TeamUser; roles: TenantRole[]; onClose: () => void; onSaved: (u: TeamUser) => void }) {
  const [name, setName] = useState(user.fullName ?? "");
  const [role, setRole] = useState(user.role);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [temp, setTemp] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);

  async function patch(body: Record<string, unknown>, close = true) {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/v1/team/${user.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json();
      if (!res.ok) { setError(d.error ?? "No se pudo guardar"); return; }
      onSaved({ ...user, ...d.user });
      if (close) onClose();
    } catch { setError("Sin conexión"); } finally { setBusy(false); }
  }
  async function resetPassword() {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/v1/team/${user.id}/reset-password`, { method: "POST" });
      const d = await res.json();
      if (!res.ok) { setError(d.error ?? "No se pudo generar"); return; }
      setTemp(d.tempPassword);
    } catch { setError("Sin conexión"); } finally { setBusy(false); }
  }

  return (
    <Drawer title={user.fullName ?? user.email} description={`${user.email} · último acceso ${lastAccess(user.lastLoginAt).toLowerCase()}`} onClose={onClose} locked={busy} width={480}
      footer={<>
        <button type="button" onClick={onClose} className={btn("secondary")}>Cancelar</button>
        <button type="button" disabled={busy} onClick={() => void patch({ fullName: name, role })} className={btn("primary")}>{busy && <Loader2 className="animate-spin" />} Guardar cambios</button>
      </>}>
      <div className="flex flex-col gap-5">
        <label className="flex flex-col gap-1.5"><span className="text-[13px] font-semibold">Nombre</span><input value={name} onChange={(e) => setName(e.target.value)} className={inp} /></label>
        <RolePicker roles={roles.includes(user.role as TenantRole) ? roles : [...roles, user.role as TenantRole]} value={role} onChange={setRole} name="edit-role" />
        <section className="flex flex-col gap-3 border-t border-line-soft pt-4">
          <h3 className="text-[13px] font-semibold">Acceso</h3>
          <div className="flex items-start justify-between gap-3">
            <p className="text-[13px]"><b className="font-medium">Nueva contraseña temporal</b><span className="block text-xs text-muted-foreground">Si olvidó la suya. La actual deja de funcionar.</span></p>
            <button type="button" disabled={busy} onClick={() => void resetPassword()} className={btn("secondary", "sm")}>Generar</button>
          </div>
          {temp && <TempPassword value={temp} label="Compártela con la persona; la cambiará al entrar:" />}
          {user.isActive ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-start justify-between gap-3">
                <p className="text-[13px]"><b className="font-medium">Desactivar usuario</b><span className="block text-xs text-muted-foreground">No podrá entrar. Sus documentos, casos y decisiones se conservan.</span></p>
                {!confirmOff && <button type="button" disabled={busy} onClick={() => setConfirmOff(true)} className={btn("danger", "sm")}>Desactivar…</button>}
              </div>
              {confirmOff && (
                <Notice tone="warn" title={`¿Desactivar a ${user.fullName ?? user.email}?`} action={<span className="flex gap-2"><button type="button" onClick={() => setConfirmOff(false)} className={btn("secondary", "sm")}>Cancelar</button><button type="button" disabled={busy} onClick={() => void patch({ isActive: false })} className={btn("danger", "sm")}>Desactivar</button></span>}>
                  Se cierran sus sesiones abiertas. Puedes volver a activarlo cuando quieras.
                </Notice>
              )}
            </div>
          ) : (
            <div className="flex items-start justify-between gap-3">
              <p className="text-[13px]"><b className="font-medium">Usuario inactivo</b><span className="block text-xs text-muted-foreground">Al activarlo vuelve a entrar con su contraseña.</span></p>
              <button type="button" disabled={busy} onClick={() => void patch({ isActive: true })} className={btn("secondary", "sm")}>Activar</button>
            </div>
          )}
        </section>
        {error && <Notice tone="err" title={error} />}
      </div>
    </Drawer>
  );
}
