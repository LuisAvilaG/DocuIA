"use client";

import { FormEvent, useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, CheckCircle2, Loader2, Mail, Pencil, ShieldCheck,
  UserPlus, UsersRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type PlatformAdmin = {
  id: string;
  email: string;
  fullName: string | null;
  isActive: boolean;
  lastLoginAt: string | Date | null;
  createdAt: string | Date;
  updatedAt: string | Date;
};

type AdminResponse = { currentAdminId: string; admins: PlatformAdmin[] };

function formatDate(value: string | Date | null): string {
  if (!value) return "Nunca";
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

async function readResponse(response: Response): Promise<{ error?: string; [key: string]: unknown }> {
  return response.json().catch(() => ({}));
}

export function PlatformAdminsClient({
  initialAdmins,
  currentAdminId: initialCurrentAdminId,
}: {
  initialAdmins: PlatformAdmin[];
  currentAdminId: string;
}) {
  const router = useRouter();
  const [admins, setAdmins] = useState<PlatformAdmin[]>(initialAdmins);
  const [currentAdminId, setCurrentAdminId] = useState(initialCurrentAdminId);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [created, setCreated] = useState(false);
  const [form, setForm] = useState({ fullName: "", email: "", password: "" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ fullName: "", password: "", isActive: true });

  const loadAdmins = useCallback(async () => {
    setLoadError(null);
    try {
      const response = await fetch("/api/admin/platform-admins");
      const data = await readResponse(response) as unknown as AdminResponse & { error?: string };
      if (!response.ok) {
        if (response.status === 401) router.push("/admin/login");
        setLoadError(data.error ?? "No se pudo cargar la lista");
        return;
      }
      setAdmins(data.admins);
      setCurrentAdminId(data.currentAdminId);
    } catch {
      setLoadError("No se pudo conectar al servidor");
    }
  }, [router]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setCreateError(null);
    setCreated(false);
    try {
      const response = await fetch("/api/admin/platform-admins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await readResponse(response);
      if (!response.ok) {
        setCreateError(data.error ?? "No se pudo crear el administrador");
        return;
      }
      setForm({ fullName: "", email: "", password: "" });
      setShowCreate(false);
      setCreated(true);
      await loadAdmins();
    } catch {
      setCreateError("No se pudo conectar al servidor");
    } finally {
      setCreating(false);
    }
  }

  function startEditing(admin: PlatformAdmin) {
    setEditingId(admin.id);
    setEditForm({ fullName: admin.fullName ?? "", password: "", isActive: admin.isActive });
    setEditError(null);
  }

  async function handleSave(admin: PlatformAdmin) {
    setEditing(true);
    setEditError(null);
    try {
      const payload: { fullName: string; isActive: boolean; password?: string } = {
        fullName: editForm.fullName,
        isActive: editForm.isActive,
      };
      if (editForm.password) payload.password = editForm.password;

      const response = await fetch(`/api/admin/platform-admins/${admin.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await readResponse(response) as { error?: string; reauthenticate?: boolean };
      if (!response.ok) {
        setEditError(data.error ?? "No se pudo guardar el cambio");
        return;
      }
      if (data.reauthenticate) {
        await fetch("/api/admin/auth/logout", { method: "POST" });
        router.push("/admin/login");
        return;
      }
      setEditingId(null);
      await loadAdmins();
    } catch {
      setEditError("No se pudo conectar al servidor");
    } finally {
      setEditing(false);
    }
  }

  return (
    <div className="flex-1 flex flex-col">
      <header className="min-h-14 border-b border-border px-6 py-3 flex items-center justify-between gap-4 shrink-0">
        <div>
          <h1 className="text-sm font-semibold text-foreground">Administradores</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Acceso exclusivo al panel de plataforma.
          </p>
        </div>
        <Button size="sm" onClick={() => { setShowCreate((value) => !value); setCreateError(null); }}>
          <UserPlus />
          Nuevo administrador
        </Button>
      </header>

      <div className="flex-1 p-6 overflow-auto">
        <div className="max-w-4xl space-y-5">
          <div className="flex items-start gap-3 rounded-xl border border-primary/15 bg-primary/5 px-4 py-3">
            <ShieldCheck className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <p className="text-xs leading-5 text-muted-foreground">
              Solo un administrador de plataforma autenticado puede dar acceso a otro administrador.
              Las contraseñas no se vuelven a mostrar después de guardarlas.
            </p>
          </div>

          {created && (
            <div className="flex items-center gap-2 rounded-lg border border-success/20 bg-success/10 px-3 py-2.5 text-xs text-success" role="status">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              Administrador creado correctamente.
            </div>
          )}

          {showCreate && (
            <form onSubmit={handleCreate} className="rounded-xl border border-border bg-card p-5 space-y-4">
              <div>
                <p className="text-sm font-semibold text-foreground">Nuevo administrador</p>
                <p className="text-xs text-muted-foreground mt-1">Comparte la contraseña por un canal seguro.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="platform-admin-name" className="text-xs">Nombre completo</Label>
                  <Input id="platform-admin-name" value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} disabled={creating} placeholder="Nombre Apellido" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="platform-admin-email" className="text-xs">Email <span className="text-destructive">*</span></Label>
                  <Input id="platform-admin-email" type="email" autoComplete="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} disabled={creating} required placeholder="admin@empresa.com" />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="platform-admin-password" className="text-xs">Contraseña temporal <span className="text-destructive">*</span></Label>
                  <Input id="platform-admin-password" type="password" autoComplete="new-password" minLength={12} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} disabled={creating} required placeholder="Mínimo 12 caracteres" />
                </div>
              </div>
              {createError && <p className="flex items-center gap-1.5 text-xs text-destructive"><AlertTriangle className="w-3.5 h-3.5 shrink-0" />{createError}</p>}
              <div className="flex items-center gap-2">
                <Button type="submit" size="sm" disabled={creating}>
                  {creating && <Loader2 className="animate-spin" />}
                  Crear administrador
                </Button>
                <Button type="button" variant="ghost" size="sm" disabled={creating} onClick={() => setShowCreate(false)}>Cancelar</Button>
              </div>
            </form>
          )}

          {loadError ? (
            <div className="py-16 flex flex-col items-center text-center gap-2">
              <AlertTriangle className="w-5 h-5 text-destructive" />
              <p className="text-sm text-destructive">{loadError}</p>
              <Button variant="ghost" size="sm" onClick={() => void loadAdmins()}>Reintentar</Button>
            </div>
          ) : admins.length === 0 ? (
            <div className="py-16 flex flex-col items-center text-center">
              <UsersRound className="w-8 h-8 text-muted-foreground mb-3" />
              <p className="text-sm font-medium text-foreground">Sin administradores</p>
              <p className="text-xs text-muted-foreground mt-1">Crea el primer administrador desde el bootstrap de despliegue.</p>
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
              {admins.map((admin) => {
                const isCurrent = admin.id === currentAdminId;
                const isEditing = admin.id === editingId;
                return (
                  <section key={admin.id} className="px-4 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <ShieldCheck className="w-4 h-4 text-primary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{admin.fullName || admin.email}</p>
                          {isCurrent && <span className="text-[0.6875rem] font-medium px-2 py-0.5 rounded-sm bg-primary/10 text-primary shrink-0">Tú</span>}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
                          <Mail className="w-3 h-3 text-muted-foreground shrink-0" />
                          <p className="text-xs text-muted-foreground truncate">{admin.email}</p>
                        </div>
                      </div>
                      <div className="hidden sm:block text-right shrink-0">
                        <p className="text-[0.6875rem] text-muted-foreground">Último acceso</p>
                        <p className="text-xs text-foreground tabular-nums">{formatDate(admin.lastLoginAt)}</p>
                      </div>
                      <span className={cn("text-[0.6875rem] font-medium px-2 py-0.5 rounded-sm shrink-0", admin.isActive ? "bg-success/10 text-success" : "bg-secondary text-muted-foreground")}>
                        {admin.isActive ? "Activo" : "Inactivo"}
                      </span>
                      <Button variant="ghost" size="icon-sm" aria-label={`Gestionar ${admin.email}`} onClick={() => isEditing ? setEditingId(null) : startEditing(admin)}>
                        <Pencil />
                      </Button>
                    </div>

                    {isEditing && (
                      <div className="mt-4 pt-4 border-t border-border space-y-3">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label htmlFor={`admin-name-${admin.id}`} className="text-xs">Nombre completo</Label>
                            <Input id={`admin-name-${admin.id}`} value={editForm.fullName} onChange={(event) => setEditForm({ ...editForm, fullName: event.target.value })} disabled={editing} />
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor={`admin-password-${admin.id}`} className="text-xs">Restablecer contraseña</Label>
                            <Input id={`admin-password-${admin.id}`} type="password" autoComplete="new-password" minLength={12} placeholder="Dejar vacío para no cambiar" value={editForm.password} onChange={(event) => setEditForm({ ...editForm, password: event.target.value })} disabled={editing} />
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/45 px-3 py-2.5">
                          <div>
                            <p className="text-xs font-medium text-foreground">Acceso al panel</p>
                            <p className="text-[0.6875rem] text-muted-foreground mt-0.5">Al desactivar, sus sesiones vigentes se revocan.</p>
                          </div>
                          <Button type="button" variant={editForm.isActive ? "outline" : "secondary"} size="sm" disabled={editing || isCurrent} onClick={() => setEditForm({ ...editForm, isActive: !editForm.isActive })}>
                            {editForm.isActive ? "Desactivar" : "Activar"}
                          </Button>
                        </div>
                        {isCurrent && <p className="text-[0.6875rem] text-muted-foreground">No puedes desactivar tu propia cuenta.</p>}
                        {editError && <p className="flex items-center gap-1.5 text-xs text-destructive"><AlertTriangle className="w-3.5 h-3.5 shrink-0" />{editError}</p>}
                        <div className="flex items-center gap-2">
                          <Button size="sm" disabled={editing} onClick={() => void handleSave(admin)}>
                            {editing && <Loader2 className="animate-spin" />}
                            Guardar cambios
                          </Button>
                          <Button variant="ghost" size="sm" disabled={editing} onClick={() => setEditingId(null)}>Cancelar</Button>
                        </div>
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
