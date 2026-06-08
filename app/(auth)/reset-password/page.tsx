"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import Image from "next/image";

function ResetPasswordForm() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const token        = searchParams.get("token") ?? "";

  const [password,  setPassword]  = useState("");
  const [confirm,   setConfirm]   = useState("");
  const [showPass,  setShowPass]  = useState(false);
  const [loading,   setLoading]   = useState(false);
  const [success,   setSuccess]   = useState(false);
  const [error,     setError]     = useState("");

  useEffect(() => {
    if (!token) setError("Token inválido o expirado.");
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setError("Las contraseñas no coinciden"); return; }
    if (password.length < 8)  { setError("Mínimo 8 caracteres"); return; }

    setError("");
    setLoading(true);
    try {
      const res  = await fetch("/api/v1/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Error al restablecer"); return; }
      setSuccess(true);
      setTimeout(() => router.push("/login"), 2000);
    } catch {
      setError("No se pudo conectar al servidor");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="mb-4">
            <Image src="/logo-full.png" alt="DocuIA" width={200} height={56} className="object-contain" />
          </div>
          <p className="text-sm text-muted-foreground">Nueva contraseña</p>
        </div>

        <div className="bg-card border border-border rounded-xl p-6 shadow-ambient">
          {success ? (
            <div className="text-center space-y-3">
              <div className="w-10 h-10 rounded-full bg-emerald-400/10 border border-emerald-400/20 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              </div>
              <p className="text-sm font-medium text-foreground">Contraseña restablecida</p>
              <p className="text-xs text-muted-foreground">Redirigiendo al login...</p>
            </div>
          ) : !token ? (
            <div className="text-center space-y-3">
              <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto" />
              <p className="text-sm text-muted-foreground">Token inválido o expirado.</p>
              <Link href="/forgot-password" className="text-xs text-primary hover:underline">
                Solicitar nuevo enlace →
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[0.6875rem] font-medium text-muted-foreground uppercase tracking-[0.06em]">
                  Nueva contraseña
                </label>
                <div className="relative">
                  <input
                    type={showPass ? "text" : "password"}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Mínimo 8 caracteres"
                    required
                    autoFocus
                    className="w-full bg-card border border-border rounded-md px-3 py-[9px] pr-10 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none transition-all duration-[120ms] focus:border-primary focus:shadow-[0_0_0_3px_oklch(0.48_0.15_182_/_0.12)]"
                  />
                  <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[0.6875rem] font-medium text-muted-foreground uppercase tracking-[0.06em]">
                  Confirmar contraseña
                </label>
                <input
                  type={showPass ? "text" : "password"}
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  placeholder="Repite la contraseña"
                  required
                  className="w-full bg-card border border-border rounded-md px-3 py-[9px] text-sm text-foreground placeholder:text-muted-foreground/50 outline-none transition-all duration-[120ms] focus:border-primary focus:shadow-[0_0_0_3px_oklch(0.48_0.15_182_/_0.12)]"
                />
              </div>

              {error && <p className="text-xs text-destructive px-1">{error}</p>}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-primary hover:bg-[oklch(0.42_0.15_182)] disabled:opacity-60 text-primary-foreground font-medium text-sm py-[10px] rounded-md transition-all duration-[120ms] flex items-center justify-center gap-2 mt-2"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                {loading ? "Guardando..." : "Restablecer contraseña"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
