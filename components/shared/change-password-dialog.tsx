"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { KeyRound, X, Loader2, CheckCircle2, Eye, EyeOff } from "lucide-react";

// Self-service password change for any signed-in tenant user (tenant portal
// and expenses portal share it).
export function ChangePasswordDialog({ open, onClose, userEmail }: { open: boolean; onClose: () => void; userEmail: string }) {
  const [currentPwd,    setCurrentPwd]    = useState("");
  const [newPwd,        setNewPwd]        = useState("");
  const [confirmPwd,    setConfirmPwd]    = useState("");
  const [showCurrent,   setShowCurrent]   = useState(false);
  const [showNew,       setShowNew]       = useState(false);
  const [pwdSaving,     setPwdSaving]     = useState(false);
  const [pwdError,      setPwdError]      = useState("");
  const [pwdDone,       setPwdDone]       = useState(false);
  const [wasOpen,       setWasOpen]       = useState(open);

  function reset() {
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
      setTimeout(onClose, 2000);
    } catch {
      setPwdError("No se pudo conectar al servidor");
    } finally {
      setPwdSaving(false);
    }
  }

  // Start clean every time the dialog opens.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) reset();
  }

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.5)", backdropFilter: "blur(2px)" }}
          onClick={e => { if (e.target === e.currentTarget) onClose(); }}
        >
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Cambiar contraseña</h2>
                <p className="text-xs text-muted-foreground mt-0.5">{userEmail}</p>
              </div>
              <button onClick={() => onClose()} className="text-muted-foreground hover:text-foreground transition-colors">
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
    </>
  );
}
