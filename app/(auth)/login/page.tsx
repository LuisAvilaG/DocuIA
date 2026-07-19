"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import Image from "next/image";

export default function TenantLoginPage() {
  const router = useRouter();
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res  = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Error al iniciar sesión"); return; }
      router.push("/dashboard");
    } catch {
      setError("No se pudo conectar al servidor");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-6 py-14"
      style={{ backgroundColor: "oklch(0.975 0.006 240)" }}
    >
      {/* Logo hero — grande y prominente */}
      <div className="mb-10 select-none w-full max-w-[520px]">
        <Image
          src="/logo-full.png"
          alt="DocuIA"
          width={520}
          height={290}
          className="object-contain w-full"
          priority
        />
      </div>

      {/* Formulario de acceso */}
      <div
        className="w-full max-w-[400px] bg-card border rounded-xl overflow-hidden"
        style={{
          borderColor: "oklch(0.91 0.006 240)",
          boxShadow: "0 4px 24px oklch(0.22 0.10 240 / 0.07), 0 1px 4px oklch(0.22 0.10 240 / 0.04)",
        }}
      >
        <div className="px-6 pt-6 pb-1">
          <p className="text-sm font-semibold tracking-[-0.01em] text-foreground">Accede a tu organización</p>
          <p className="text-xs text-muted-foreground mt-0.5">Usa las credenciales que te asignó tu administrador.</p>
        </div>

        <form onSubmit={handleSubmit} className="px-6 pb-6 pt-5 space-y-4">

          <div className="space-y-1.5">
            <label className="text-[0.6875rem] font-medium text-muted-foreground uppercase tracking-[0.06em]">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="tu@empresa.com"
              required
              autoFocus
              className="w-full bg-background border border-border rounded-lg px-3 py-[9px] text-base sm:text-sm text-foreground placeholder:text-muted-foreground/50 outline-none transition-[border-color,box-shadow] duration-[120ms] focus:border-primary focus:shadow-[0_0_0_3px_oklch(0.48_0.15_182_/_0.12)]"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[0.6875rem] font-medium text-muted-foreground uppercase tracking-[0.06em]">
                Contraseña
              </label>
              <a
                href="/forgot-password"
                className="text-[0.6875rem] text-muted-foreground hover:text-primary transition-colors duration-[120ms]"
              >
                ¿La olvidaste?
              </a>
            </div>
            <div className="relative">
              <input
                type={showPass ? "text" : "password"}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full bg-background border border-border rounded-lg px-3 py-[9px] pr-10 text-base sm:text-sm text-foreground placeholder:text-muted-foreground/50 outline-none transition-[border-color,box-shadow] duration-[120ms] focus:border-primary focus:shadow-[0_0_0_3px_oklch(0.48_0.15_182_/_0.12)]"
              />
              <button
                type="button"
                onClick={() => setShowPass(!showPass)}
                tabIndex={-1}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors duration-[120ms]"
              >
                {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2.5 bg-[oklch(0.96_0.04_25)] border border-[oklch(0.50_0.20_25_/_0.18)] rounded-lg px-3 py-2.5">
              <div className="mt-[3px] w-1.5 h-1.5 rounded-full bg-[oklch(0.50_0.20_25)] shrink-0" />
              <p className="text-xs text-[oklch(0.45_0.18_25)]">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary hover:bg-[oklch(0.42_0.15_182)] disabled:opacity-60 text-primary-foreground font-medium text-sm py-[10px] rounded-lg flex items-center justify-center gap-2 transition-all duration-[120ms] hover:-translate-y-px active:translate-y-0"
            style={{ boxShadow: "0 1px 3px oklch(0.48 0.15 182 / 0.30)" }}
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {loading ? "Ingresando..." : "Ingresar"}
          </button>
        </form>
      </div>
    </div>
  );
}
