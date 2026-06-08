"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, ArrowLeft, CheckCircle2 } from "lucide-react";
import Image from "next/image";

export default function ForgotPasswordPage() {
  const [email,   setEmail]   = useState("");
  const [loading, setLoading] = useState(false);
  const [sent,    setSent]    = useState(false);
  const [error,   setError]   = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res  = await fetch("/api/v1/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Error al enviar"); return; }
      setSent(true);
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
          <p className="text-sm text-muted-foreground">Recuperar contraseña</p>
        </div>

        <div className="bg-card border border-border rounded-xl p-6 shadow-ambient">
          {sent ? (
            <div className="text-center space-y-3">
              <div className="w-10 h-10 rounded-full bg-emerald-400/10 border border-emerald-400/20 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              </div>
              <p className="text-sm font-medium text-foreground">Revisa tu correo</p>
              <p className="text-xs text-muted-foreground">
                Si el email está registrado, recibirás un enlace para restablecer tu contraseña.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Ingresa tu email y te enviaremos un enlace para restablecer tu contraseña.
              </p>

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
                {loading ? "Enviando..." : "Enviar enlace"}
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6">
          <Link href="/login" className="text-primary hover:text-[oklch(0.42_0.15_182)] transition-colors flex items-center justify-center gap-1">
            <ArrowLeft className="w-3 h-3" /> Volver al login
          </Link>
        </p>
      </div>
    </div>
  );
}
