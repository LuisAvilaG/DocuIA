"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw } from "lucide-react";
import { btn } from "@/components/kit";

/** Vuelve a analizar un caso cuyo análisis no terminó, con los documentos que ya tiene. */
export function RetryAnalysis({ caseId }: { caseId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function retry() {
    setBusy(true); setError("");
    try {
      const res = await fetch(`/api/v1/contracts/cases/${caseId}/reprocess`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "No se pudo volver a analizar el caso."); return; }
      router.refresh();
    } catch { setError("No se pudo conectar con el servidor."); } finally { setBusy(false); }
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => void retry()} disabled={busy} className={btn("secondary", "sm")}>
        {busy ? <Loader2 className="animate-spin" /> : <RotateCcw />}Volver a analizar
      </button>
      {error && <span role="alert" className="text-[13px] text-tone-err">{error}</span>}
    </div>
  );
}
