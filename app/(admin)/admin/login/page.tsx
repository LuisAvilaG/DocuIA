"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { safeAdminReturnPath } from "@/lib/security/return-path";
import { Eye, EyeOff, Loader2, LayoutDashboard, Building2, Cpu, ScrollText } from "lucide-react";

const SECTIONS = [
  { icon: LayoutDashboard, label: "Monitor de hoy" },
  { icon: Building2,       label: "Expediente por cliente" },
  { icon: Cpu,             label: "Productos y features" },
  { icon: ScrollText,      label: "Auditoría del equipo" },
];

function greetingFor(hour: number): string {
  if (hour < 12) return "Buenos días.";
  if (hour < 19) return "Buenas tardes.";
  return "Buenas noches.";
}

function AdminLoginForm() {
  const router = useRouter();
  const returnTo = safeAdminReturnPath(useSearchParams().get("returnTo"));
  const [restoring, setRestoring] = useState(() => Boolean(returnTo));
  // Rendered after mount so the server HTML never disagrees with the client's
  // clock; deferred so the setState isn't called synchronously in the effect body.
  const [greeting, setGreeting] = useState("Hola.");
  useEffect(() => { queueMicrotask(() => setGreeting(greetingFor(new Date().getHours()))); }, []);

  // The proxy sends here with ?returnTo when only the short-lived access token
  // expired; the refresh cookie usually still renews the session silently.
  useEffect(() => {
    if (!returnTo) return;
    let active = true;
    fetch("/api/admin/auth/refresh", { method: "POST" })
      .then((res) => { if (active && res.ok) router.replace(returnTo); })
      .catch(() => undefined)
      .finally(() => { if (active) setRestoring(false); });
    return () => { active = false; };
  }, [returnTo, router]);

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
      router.push(returnTo ?? "/admin");
    } catch {
      setError("Error de conexión. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  const field = "w-full bg-white border border-border rounded-lg px-3 py-[11px] text-sm text-foreground placeholder:text-muted-foreground/50 outline-none transition-[border-color,box-shadow] duration-[120ms] focus:border-primary focus:shadow-[0_0_0_3px_oklch(0.48_0.15_182_/_0.12)]";

  return (
    <div className="min-h-screen flex bg-background">

      {/* Navy column: brand, what the panel holds, the operator */}
      <aside
        className="hidden md:flex w-[300px] shrink-0 flex-col justify-between px-8 py-9 relative overflow-hidden"
        style={{ backgroundColor: "oklch(0.22 0.10 240)" }}
      >
        <div aria-hidden="true" className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(ellipse 90% 45% at 20% 100%, oklch(0.65 0.14 182 / 0.20) 0%, transparent 70%)" }} />
        <div aria-hidden="true" />
        <div className="relative text-[13px] leading-[1.7]" style={{ color: "oklch(0.72 0.02 240)" }}>
          <p className="text-[28px] font-bold tracking-[-0.025em] leading-none mb-3.5" style={{ color: "oklch(0.92 0.004 240)" }}>DocuIA</p>
          <p className="text-[11px] font-semibold tracking-[0.12em] uppercase" style={{ color: "oklch(0.65 0.14 182)" }}>Plataforma</p>
          <p className="mt-3 text-[20px] font-semibold tracking-[-0.02em] leading-[1.3]" style={{ color: "oklch(0.92 0.004 240)" }}>
            Clientes, productos, conexiones ERP y auditoría del equipo.
          </p>
          <ul className="mt-5 flex flex-col gap-2.5" style={{ color: "oklch(0.82 0.01 240)" }}>
            {SECTIONS.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-3">
                <span className="w-[26px] h-[26px] rounded-[7px] inline-flex items-center justify-center" style={{ backgroundColor: "oklch(0.92 0.004 240 / 0.08)", color: "oklch(0.65 0.14 182)" }}>
                  <Icon className="w-[13px] h-[13px]" aria-hidden="true" />
                </span>
                {label}
              </li>
            ))}
          </ul>
          <p className="mt-5 pt-[18px] text-[12.5px]" style={{ borderTop: "1px solid oklch(0.92 0.004 240 / 0.12)" }}>
            Acceso restringido al equipo DocuIA. Cada inicio de sesión queda en auditoría.
          </p>
        </div>
        <div className="relative text-[11.5px] tracking-[0.06em] uppercase" style={{ color: "oklch(0.55 0.02 240)" }}>Be Automate</div>
      </aside>

      {/* The logo fills the canvas as a faint watermark; the form floats on a paper card */}
      <main className="flex-1 min-w-0 relative flex items-center px-6 py-12 md:px-24 overflow-hidden">
        <Image
          src="/logo-full.png"
          alt=""
          aria-hidden="true"
          width={960}
          height={536}
          priority
          className="absolute right-[-120px] top-1/2 -translate-y-1/2 w-[960px] max-w-none h-auto opacity-[0.07] pointer-events-none select-none hidden sm:block"
        />

        <section className="relative w-full max-w-[440px] bg-card border border-border rounded-[20px] p-8 sm:p-10 flex flex-col gap-6"
          style={{ boxShadow: "0 20px 60px oklch(0.18 0.015 258 / 0.10), 0 4px 16px oklch(0.18 0.015 258 / 0.05)" }}>
          <div>
            <p className="text-[11px] font-semibold tracking-[0.12em] uppercase text-primary mb-1.5">DocuIA · Plataforma</p>
            <h1 className="text-[28px] font-semibold tracking-[-0.025em] leading-[1.15] text-foreground">{greeting}<br />Entra al panel.</h1>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="admin-email" className="text-[11px] font-medium tracking-[0.06em] uppercase text-muted-foreground">Email</label>
              <input
                id="admin-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nombre@docuia.com"
                required
                autoFocus
                autoComplete="email"
                className={field}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="admin-password" className="text-[11px] font-medium tracking-[0.06em] uppercase text-muted-foreground">Contraseña</label>
              <div className="relative">
                <input
                  id="admin-password"
                  type={showPass ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  required
                  autoComplete="current-password"
                  className={`${field} pr-10`}
                />
                <button
                  type="button"
                  onClick={() => setShowPass((v) => !v)}
                  aria-label={showPass ? "Ocultar contraseña" : "Mostrar contraseña"}
                  tabIndex={-1}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors duration-[120ms]"
                >
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2.5 bg-[oklch(0.96_0.04_25)] border border-[oklch(0.50_0.20_25_/_0.18)] rounded-lg px-3 py-2.5" role="alert">
                <div className="mt-[3px] w-1.5 h-1.5 rounded-full bg-[oklch(0.50_0.20_25)] shrink-0" />
                <p className="text-xs text-[oklch(0.45_0.18_25)]">{error}</p>
              </div>
            )}
            {restoring && <p className="text-xs text-muted-foreground">Restaurando tu sesión…</p>}

            <button
              type="submit"
              disabled={loading || restoring}
              className="mt-1 w-full bg-primary hover:bg-[oklch(0.42_0.15_182)] disabled:opacity-60 text-primary-foreground font-semibold text-sm py-3 rounded-lg flex items-center justify-center gap-2 transition-all duration-[120ms] hover:-translate-y-px active:translate-y-0"
              style={{ boxShadow: "0 1px 3px oklch(0.48 0.15 182 / 0.30)" }}
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? "Verificando…" : "Ingresar al panel"}
            </button>
          </form>

          <p className="text-[12.5px] text-muted-foreground leading-[1.6] border-t border-border/60 pt-4">
            ¿Olvidaste la contraseña? Otro administrador puede restablecerla desde Administradores.
          </p>
        </section>
      </main>
    </div>
  );
}

export default function AdminLoginPage() {
  return <Suspense fallback={null}><AdminLoginForm /></Suspense>;
}
