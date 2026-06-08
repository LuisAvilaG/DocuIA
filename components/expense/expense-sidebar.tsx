"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  Receipt, PlusCircle, ClipboardList, LogOut, User, KeyRound, X,
  Loader2, CheckCircle2, Eye, EyeOff, Menu,
} from "lucide-react";
import Image from "next/image";

interface Props {
  orgName:   string;
  userEmail: string;
  userRole:  string;
}

const NAV_ITEMS = [
  { href: "/expenses",      label: "Mis gastos",    icon: ClipboardList },
  { href: "/expenses/new",  label: "Nuevo informe", icon: PlusCircle },
];

const ACCOUNTING_ITEMS = [
  { href: "/accounting/expenses", label: "Revisión de gastos", icon: ClipboardList },
];

export function ExpenseSidebar({ orgName, userEmail, userRole }: Props) {
  const pathname = usePathname();
  const router   = useRouter();

  const [open,          setOpen]          = useState(false);
  const [showChangePwd, setShowChangePwd] = useState(false);
  const [currentPwd,    setCurrentPwd]    = useState("");
  const [newPwd,        setNewPwd]        = useState("");
  const [confirmPwd,    setConfirmPwd]    = useState("");
  const [showCurrent,   setShowCurrent]   = useState(false);
  const [showNew,       setShowNew]       = useState(false);
  const [pwdSaving,     setPwdSaving]     = useState(false);
  const [pwdError,      setPwdError]      = useState("");
  const [pwdDone,       setPwdDone]       = useState(false);

  function closeDrawer() { setOpen(false); }

  function openChangePwd() {
    setShowChangePwd(true);
    setCurrentPwd(""); setNewPwd(""); setConfirmPwd("");
    setPwdError(""); setPwdDone(false);
  }

  async function handleChangePwd(e: React.FormEvent) {
    e.preventDefault();
    if (newPwd !== confirmPwd) { setPwdError("Las contraseñas nuevas no coinciden"); return; }
    if (newPwd.length < 8)    { setPwdError("Mínimo 8 caracteres"); return; }
    setPwdSaving(true); setPwdError("");
    try {
      const res  = await fetch("/api/v1/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: currentPwd, newPassword: newPwd }),
      });
      const data = await res.json();
      if (!res.ok) { setPwdError(data.error ?? "Error al cambiar contraseña"); return; }
      setPwdDone(true);
      setTimeout(() => setShowChangePwd(false), 2000);
    } catch {
      setPwdError("No se pudo conectar al servidor");
    } finally {
      setPwdSaving(false);
    }
  }

  async function handleLogout() {
    await fetch("/api/v1/auth/logout", { method: "POST" });
    router.push("/login");
  }

  const isAdmin = userRole === "admin";

  return (
    <>
      {/* Mobile hamburger button */}
      <button
        onClick={() => setOpen(true)}
        className="fixed top-4 left-4 z-40 lg:hidden flex items-center justify-center w-9 h-9 rounded-lg bg-card border border-border shadow-sm text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Abrir menú"
      >
        <Menu className="w-4 h-4" />
      </button>

      {/* Backdrop (mobile only) */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-[oklch(0.18_0.015_258)]/60 lg:hidden"
          onClick={closeDrawer}
        />
      )}

      {/* Sidebar */}
      <aside className={cn(
        "fixed left-0 top-0 h-full w-56 bg-card border-r border-border flex flex-col z-40",
        "transition-transform duration-300 ease-out",
        open ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
      )}>
        {/* Logo + mobile close */}
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <Image src="/logo-icon.png" alt="DocuIA" width={28} height={28} className="rounded shrink-0" />
            <div className="min-w-0">
              <p className="text-[0.8125rem] font-semibold text-foreground truncate">{orgName}</p>
              <p className="text-[0.6875rem] text-muted-foreground">Gastos</p>
            </div>
          </div>
          <button
            onClick={closeDrawer}
            className="lg:hidden p-1 text-muted-foreground hover:text-foreground transition-colors shrink-0"
            aria-label="Cerrar menú"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
          <p className="text-[0.6875rem] font-medium text-muted-foreground uppercase tracking-[0.06em] px-2 py-1.5">
            Mis gastos
          </p>
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || (href !== "/expenses" && pathname.startsWith(href));
            return (
              <Link
                key={href}
                href={href}
                onClick={closeDrawer}
                className={cn(
                  "flex items-center gap-2.5 px-2.5 py-3 lg:py-2 rounded-lg text-[0.8125rem] transition-colors",
                  active
                    ? "bg-accent text-accent-foreground font-semibold"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {label}
              </Link>
            );
          })}

          {isAdmin && (
            <>
              <p className="text-[0.6875rem] font-medium text-muted-foreground uppercase tracking-[0.06em] px-2 py-1.5 mt-3">
                Contabilidad
              </p>
              {ACCOUNTING_ITEMS.map(({ href, label, icon: Icon }) => {
                const active = pathname.startsWith(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={closeDrawer}
                    className={cn(
                      "flex items-center gap-2.5 px-2.5 py-3 lg:py-2 rounded-lg text-[0.8125rem] transition-colors",
                      active
                        ? "bg-accent text-accent-foreground font-semibold"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                    )}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    {label}
                  </Link>
                );
              })}
            </>
          )}
        </nav>

        {/* User footer */}
        <div className="p-3 border-t border-border">
          <div className="flex items-center gap-2 px-1 mb-2">
            <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <User className="w-3.5 h-3.5 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-[0.75rem] text-foreground truncate">{userEmail}</p>
              <p className="text-[0.6875rem] text-muted-foreground capitalize">
                {userRole === "expense_submitter" ? "Empleado" : userRole}
              </p>
            </div>
          </div>
          <button
            onClick={openChangePwd}
            className="flex items-center gap-2 px-2 py-2.5 lg:py-1.5 w-full rounded-lg text-[0.8125rem] text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
          >
            <KeyRound className="w-3.5 h-3.5 shrink-0" />
            Cambiar contraseña
          </button>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 px-2 py-2.5 lg:py-1.5 w-full rounded-lg text-[0.8125rem] text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5 shrink-0" />
            Cerrar sesión
          </button>
        </div>

        {/* Change password modal */}
        {showChangePwd && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ backgroundColor: "rgba(0,0,0,0.5)", backdropFilter: "blur(2px)" }}
            onClick={e => { if (e.target === e.currentTarget) setShowChangePwd(false); }}
          >
            <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm p-6">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Cambiar contraseña</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">{userEmail}</p>
                </div>
                <button onClick={() => setShowChangePwd(false)} className="text-muted-foreground hover:text-foreground transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {pwdDone ? (
                <div className="py-6 flex flex-col items-center gap-3 text-center">
                  <CheckCircle2 className="w-8 h-8 text-success" />
                  <p className="text-sm font-medium text-foreground">Contraseña actualizada</p>
                  <p className="text-xs text-muted-foreground">Usa tu nueva contraseña la próxima vez que inicies sesión.</p>
                </div>
              ) : (
                <form onSubmit={handleChangePwd} className="space-y-4">
                  <div>
                    <label className="text-[0.6875rem] font-medium text-muted-foreground uppercase tracking-[0.06em] mb-1.5 block">
                      Contraseña actual
                    </label>
                    <div className="relative">
                      <input
                        type={showCurrent ? "text" : "password"}
                        value={currentPwd}
                        onChange={e => setCurrentPwd(e.target.value)}
                        required
                        autoComplete="current-password"
                        className="w-full bg-secondary/50 border border-border/60 rounded-lg px-3 pr-9 py-2.5 text-base lg:text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/60"
                      />
                      <button type="button" tabIndex={-1} onClick={() => setShowCurrent(v => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                        {showCurrent ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="text-[0.6875rem] font-medium text-muted-foreground uppercase tracking-[0.06em] mb-1.5 block">
                      Nueva contraseña <span className="normal-case text-muted-foreground/60 font-normal">(mín. 8 caracteres)</span>
                    </label>
                    <div className="relative">
                      <input
                        type={showNew ? "text" : "password"}
                        value={newPwd}
                        onChange={e => setNewPwd(e.target.value)}
                        required
                        autoComplete="new-password"
                        className="w-full bg-secondary/50 border border-border/60 rounded-lg px-3 pr-9 py-2.5 text-base lg:text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/60"
                      />
                      <button type="button" tabIndex={-1} onClick={() => setShowNew(v => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                        {showNew ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="text-[0.6875rem] font-medium text-muted-foreground uppercase tracking-[0.06em] mb-1.5 block">
                      Confirmar nueva contraseña
                    </label>
                    <input
                      type="password"
                      value={confirmPwd}
                      onChange={e => setConfirmPwd(e.target.value)}
                      required
                      autoComplete="new-password"
                      className={cn(
                        "w-full bg-secondary/50 border rounded-lg px-3 py-2.5 text-base lg:text-sm text-foreground focus:outline-none transition-colors",
                        confirmPwd && confirmPwd !== newPwd
                          ? "border-destructive/60 focus:border-destructive"
                          : "border-border/60 focus:border-primary/60"
                      )}
                    />
                    {confirmPwd && confirmPwd !== newPwd && (
                      <p className="text-[0.6875rem] text-destructive mt-1">Las contraseñas no coinciden</p>
                    )}
                  </div>

                  {pwdError && <p className="text-xs text-destructive">{pwdError}</p>}

                  <button
                    type="submit"
                    disabled={pwdSaving || !currentPwd || !newPwd || newPwd !== confirmPwd}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-40"
                  >
                    {pwdSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                    {pwdSaving ? "Guardando..." : "Actualizar contraseña"}
                  </button>
                </form>
              )}
            </div>
          </div>
        )}
      </aside>
    </>
  );
}
