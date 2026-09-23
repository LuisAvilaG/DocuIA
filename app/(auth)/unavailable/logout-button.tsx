"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

export function LogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function logout() {
    setLoading(true);
    await fetch("/api/v1/auth/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/login");
  }

  return (
    <button
      type="button"
      onClick={logout}
      disabled={loading}
      className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline disabled:opacity-60"
    >
      {loading && <Loader2 className="w-4 h-4 animate-spin" />}
      Cerrar sesión e ingresar con otra cuenta
    </button>
  );
}
