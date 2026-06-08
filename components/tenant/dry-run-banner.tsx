"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FlaskConical, X, Loader2 } from "lucide-react";

export function DryRunBanner({ isAdmin }: { isAdmin: boolean }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function disable() {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/features/dry-run", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isEnabled: false }),
      });
      if (res.ok) router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="shrink-0 flex items-center justify-between gap-3 px-6 py-2 border-b"
      style={{ backgroundColor: "oklch(0.97 0.03 80)", borderColor: "oklch(0.75 0.12 80 / 0.3)" }}>
      <div className="flex items-center gap-2 text-xs">
        <FlaskConical className="w-3.5 h-3.5 shrink-0" style={{ color: "oklch(0.58 0.16 80)" }} />
        <span className="font-semibold" style={{ color: "oklch(0.50 0.14 80)" }}>Modo prueba activo</span>
        <span className="hidden sm:inline" style={{ color: "oklch(0.58 0.14 80 / 0.75)" }}>
          — Los documentos se validan contra NetSuite pero no se crean transacciones reales.
        </span>
      </div>
      {isAdmin && (
        <button
          onClick={disable}
          disabled={loading}
          className="shrink-0 flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-lg border transition-all disabled:opacity-50"
          style={{
            color: "oklch(0.50 0.14 80)",
            borderColor: "oklch(0.75 0.12 80 / 0.4)",
            backgroundColor: "oklch(0.94 0.04 80 / 0.6)",
          }}
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
          Desactivar
        </button>
      )}
    </div>
  );
}
