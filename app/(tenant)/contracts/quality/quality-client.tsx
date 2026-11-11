"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { btn, EmptyState, Notice, PageFrame, ViewTabs } from "@/components/kit";

interface Learning {
  id: number;
  documentType: string;
  fieldKey: string;
  originalValue: string | null;
  correctedValue: string;
  citation: string | null;
  isActive: boolean;
  createdAt: string;
}

type Tab = "active" | "paused";

export function ContractLearningClient({ learnings }: { learnings: Learning[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("active");
  const [busy, setBusy] = useState<number | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function call(id: number, init: RequestInit) {
    setBusy(id); setError(null);
    try {
      const response = await fetch(`/api/v1/contracts/learnings/${id}`, init);
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "No se pudo completar la acción.");
      setConfirming(null);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo completar la acción.");
    } finally {
      setBusy(null);
    }
  }
  const toggle = (l: Learning) => call(l.id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: l.isActive ? "pause" : "resume" }) });
  const retire = (l: Learning) => call(l.id, { method: "DELETE" });

  const active = learnings.filter((l) => l.isActive);
  const paused = learnings.filter((l) => !l.isActive);
  const list = tab === "active" ? active : paused;

  return (
    <PageFrame>
      <p className="text-xs font-semibold uppercase tracking-[0.06em] text-link">Configuración</p>
      <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-[-0.025em]">Aprendizajes</h1>
      <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">Correcciones que DocuIA usa como ejemplo al leer documentos del mismo tipo. Se crean al corregir un dato en un caso y marcar «Recordar».</p>

      <ViewTabs className="mt-6" items={[
        { key: "active", label: "Activos", count: active.length, active: tab === "active", onSelect: () => { setTab("active"); setConfirming(null); } },
        { key: "paused", label: "En pausa", count: paused.length, active: tab === "paused", onSelect: () => { setTab("paused"); setConfirming(null); } },
      ]} />

      {error && <Notice className="mt-4" tone="err" title="No se pudo completar">{error}</Notice>}

      {list.length === 0 ? (
        <EmptyState className="mt-4.5" title={tab === "active" ? "Sin aprendizajes activos" : "Nada en pausa"}>
          {tab === "active" ? "Corrige un dato dentro de un caso y marca «Recordar» para crear el primero." : "Pausa un aprendizaje para dejar de usarlo sin perderlo."}
        </EmptyState>
      ) : (
        <ul className="mt-4.5 overflow-hidden rounded-xl border border-border bg-card">
          {list.map((l) => (
            <li key={l.id} className="grid gap-3 border-b border-line-soft px-5 py-4 last:border-0 md:grid-cols-[minmax(160px,0.8fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-start">
              <div className="min-w-0">
                <b className="block truncate text-sm font-semibold">{l.documentType}</b>
                <code className="mt-0.5 inline-block break-all rounded bg-secondary px-1.5 py-0.5 text-xs">{l.fieldKey}</code>
                <span className="mt-1 block text-xs text-muted-foreground">{new Date(l.createdAt).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" })}</span>
              </div>
              <div className="min-w-0 text-[13.5px]">
                <span className="block text-xs text-muted-foreground">La IA leyó</span>
                <span className="break-words text-foreground/75 line-through decoration-muted-foreground/60">{l.originalValue || "Sin valor"}</span>
              </div>
              <div className="min-w-0 text-[13.5px]">
                <span className="block text-xs text-muted-foreground">Ahora usa</span>
                <b className="break-words font-semibold">{l.correctedValue}</b>
                {l.citation && <span className="mt-1 block line-clamp-2 text-xs text-muted-foreground">Evidencia: {l.citation}</span>}
              </div>
              <div className="flex flex-wrap items-center gap-2 md:justify-end">
                {confirming === l.id ? (
                  <span role="group" aria-label="Confirmar retiro" className="flex flex-wrap items-center gap-2 text-[13px]">
                    <span className="text-tone-err">¿Retirarlo? No se puede deshacer.</span>
                    <button type="button" disabled={busy === l.id} onClick={() => retire(l)} className={btn("danger", "sm")}>{busy === l.id && <Loader2 className="animate-spin" />}Sí, retirar</button>
                    <button type="button" disabled={busy === l.id} onClick={() => setConfirming(null)} className={btn("text", "sm")}>Cancelar</button>
                  </span>
                ) : (
                  <>
                    <button type="button" disabled={busy === l.id} onClick={() => toggle(l)} className={btn("secondary", "sm")}>{busy === l.id && <Loader2 className="animate-spin" />}{l.isActive ? "Pausar" : "Reactivar"}</button>
                    <button type="button" disabled={busy === l.id} onClick={() => setConfirming(l.id)} className={btn("text", "sm", "hover:text-tone-err")}>Retirar</button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </PageFrame>
  );
}
