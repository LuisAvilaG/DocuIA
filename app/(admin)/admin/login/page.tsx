"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react";
import Image from "next/image";

export default function AdminLoginPage() {
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
      const res  = await fetch("/api/admin/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Credenciales inválidas"); return; }
      router.push("/admin");
    } catch {
      setError("Error de conexión. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex">

      {/* Panel izquierdo — Navy brand, solo desktop */}
      <div
        className="hidden lg:flex w-[44%] flex-col items-stretch justify-center relative overflow-hidden shrink-0"
        style={{ backgroundColor: "oklch(0.22 0.10 240)" }}
      >
        {/* Fondo orbital sutil */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `
              radial-gradient(ellipse 60% 50% at 25% 75%, oklch(0.48 0.15 182 / 0.07) 0%, transparent 70%),
              radial-gradient(ellipse 50% 40% at 80% 20%, oklch(0.48 0.15 182 / 0.05) 0%, transparent 60%)
            `,
          }}
        />
        {/* Grid de fondo muy sutil */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `
              linear-gradient(oklch(0.92 0.004 240 / 0.03) 1px, transparent 1px),
              linear-gradient(90deg, oklch(0.92 0.004 240 / 0.03) 1px, transparent 1px)
            `,
            backgroundSize: "48px 48px",
          }}
        />

        {/* Logo */}
        <div className="relative z-10 flex flex-col items-center">
          <div className="w-full py-10 px-10 flex items-center justify-center">
            <Image
              src="/logo-full.png"
              alt="DocuIA"
              width={420}
              height={234}
              className="object-contain w-full max-w-[420px] brightness-0 invert opacity-90"
              priority
            />
          </div>

          <p
            className="mt-8 text-sm font-medium leading-relaxed px-10 text-center"
            style={{ color: "oklch(0.58 0.010 240)" }}
          >
            Panel de Administración de Plataforma
          </p>
        </div>

        {/* Pie del panel */}
        <p
          className="absolute bottom-8 left-0 right-0 text-center text-[0.6875rem]"
          style={{ color: "oklch(0.40 0.007 240)" }}
        >
          Acceso restringido al equipo DocuIA
        </p>
      </div>

      {/* Panel derecho — Formulario */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 py-12 bg-background">

        {/* Logo visible solo en móvil */}
        <div className="lg:hidden mb-10 select-none w-full max-w-[400px]">
          <Image
            src="/logo-full.png"
            alt="DocuIA"
            width={400}
            height={223}
            className="object-contain w-full"
            priority
          />
        </div>

        <div className="w-full max-w-[360px]">

          {/* Encabezado de formulario */}
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-1">
              <ShieldCheck className="w-4 h-4 text-primary shrink-0" />
              <p className="text-sm font-semibold tracking-[-0.01em] text-foreground">Acceso restringido</p>
            </div>
            <p className="text-xs text-muted-foreground pl-6">Solo para el equipo DocuIA.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">

            <div className="space-y-1.5">
              <label className="text-[0.6875rem] font-medium text-muted-foreground uppercase tracking-[0.06em]">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="admin@docuia.com"
                required
                autoFocus
                autoComplete="email"
                className="w-full bg-card border border-border rounded-lg px-3 py-[9px] text-sm text-foreground placeholder:text-muted-foreground/50 outline-none transition-[border-color,box-shadow] duration-[120ms] focus:border-primary focus:shadow-[0_0_0_3px_oklch(0.48_0.15_182_/_0.12)]"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[0.6875rem] font-medium text-muted-foreground uppercase tracking-[0.06em]">
                Contraseña
              </label>
              <div className="relative">
                <input
                  type={showPass ? "text" : "password"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                  className="w-full bg-card border border-border rounded-lg px-3 py-[9px] pr-10 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none transition-[border-color,box-shadow] duration-[120ms] focus:border-primary focus:shadow-[0_0_0_3px_oklch(0.48_0.15_182_/_0.12)]"
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
              {loading ? "Verificando..." : "Ingresar al panel"}
            </button>
          </form>

          <p className="mt-6 text-center text-[0.6875rem] text-muted-foreground/40">
            DocuIA Platform · Acceso solo para administradores
          </p>
        </div>
      </div>
    </div>
  );
}
