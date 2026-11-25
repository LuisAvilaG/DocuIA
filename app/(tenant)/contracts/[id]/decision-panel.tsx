"use client";

// La decisión del caso, al lado del resumen de lo que se aprueba. Es una
// columna de renglones con línea fina, como el resumen: sin tarjeta ni
// recuadro dentro. Pendiente: quién debe aprobar y el formulario de decisión
// (el mismo de Aprobaciones). Tomada: el estado, quién y cuándo, el siguiente
// paso y reabrir.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { btn, StatusPill } from "@/components/kit";
import { DecisionForm } from "../components/decision-form";

interface Decision { action?: string; reason?: string | null; byEmail?: string | null; at?: string | null; override?: boolean; support?: { name?: string } }
export interface DecisionStep { key: string; label: string; who: string; signed: string | null }

const row = "flex flex-col gap-2 border-t border-border py-4 text-[13.5px] first-of-type:border-foreground";
const label = "text-[11.5px] font-semibold uppercase tracking-[0.05em] text-foreground/75";
const hint = "text-[12.5px] text-muted-foreground";

export function DecisionPanel({ caseId, caseTitle, status, verdict, decision, decidedAt, hasOutput, generationEnabled, approvalEnabled, allowOverride, canManage, steps, openFindings, requestsEnabled }: {
  caseId: string;
  caseTitle: string;
  status: string;
  verdict?: "ok" | "warn" | "block" | null;
  decision?: Decision | null;
  /** When it was decided, already written in the client's time zone. */
  decidedAt: string | null;
  hasOutput: boolean;
  generationEnabled: boolean;
  /** Off for a case decided before the approval workflow was turned off: it is shown, not reopened. */
  approvalEnabled: boolean;
  allowOverride: boolean;
  canManage: boolean;
  steps: DecisionStep[];
  /** Findings still open (blocks and things to review). */
  openFindings: number;
  /** Rejecting can also ask the contractor for corrected documents. */
  requestsEnabled: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"generate" | "reopen" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const approved = status === "approved" || (status === "generated" && decision?.action === "approve");
  const rejected = status === "rejected";
  const decided = approved || rejected;
  const deciding = approvalEnabled && !decided && canManage && status === "validated";

  async function run(action: "generate" | "reopen") {
    setError(null);
    setBusy(action);
    try {
      const response = await fetch(`/api/v1/contracts/cases/${caseId}/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (!response.ok) { setError(typeof data.error === "string" ? data.error : "No se pudo completar. Intenta de nuevo."); return; }
      // A document just generated is shown where it can be read.
      if (action === "generate") router.push("?etapa=doc");
      router.refresh();
    } catch {
      setError("No se pudo conectar con DocuIA. Revisa tu conexión e inténtalo de nuevo.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="dec-h" className="flex min-w-0 flex-[1_1_300px] flex-col lg:max-w-[340px]">
      <h2 id="dec-h" className="mb-3 text-[17px] font-semibold tracking-[-0.015em]">{decided ? "Decisión" : "Tu decisión"}</h2>

      {decided ? (
        <>
          <div className={row}>
            <span className="inline-flex items-center gap-2.5 text-base font-semibold tracking-[-0.01em]">
              <span aria-hidden className={cn("size-[9px] shrink-0 rounded-full", approved ? "bg-tone-ok" : "bg-tone-err")} />
              {rejected ? "Rechazado" : decision?.override ? "Aprobado con excepción" : "Aprobado"}
            </span>
            {(decision?.byEmail || decidedAt) && <span>{decision?.byEmail}{decidedAt && <span className={cn("block", hint)}>{decidedAt}</span>}</span>}
            {decision?.reason && <q className="italic text-foreground/75">{decision.reason}</q>}
            {decision?.support?.name && <span>Soporte: <a href={`/api/v1/contracts/cases/${caseId}/support`} className="text-link hover:underline">{decision.support.name}</a></span>}
          </div>
          {steps.length > 1 && (
            <div className={row}>
              <span className={label}>Aprobaciones</span>
              {steps.map((step) => <span key={step.key}><b className="font-semibold">{step.label}</b><span className={cn("block", hint)}>{step.signed ?? "Sin firma registrada"}</span></span>)}
            </div>
          )}
          {approved && generationEnabled && (
            <div className={row}>
              {hasOutput ? (
                <>
                  <span className={label}>Documento</span>
                  <span>Ya está generado. <Link href="?etapa=doc" className="font-semibold text-link hover:underline">Ver el documento</Link></span>
                </>
              ) : (
                <>
                  <span className={label}>Siguiente paso</span>
                  <span>Falta generar el documento del flujo.</span>
                  {canManage && (
                    <button type="button" onClick={() => void run("generate")} disabled={busy !== null} className={btn("primary", "md", "min-h-11")}>
                      {busy === "generate" && <Loader2 className="animate-spin" />}{busy === "generate" ? "Generando…" : "Generar documento"}
                    </button>
                  )}
                </>
              )}
            </div>
          )}
          {approvalEnabled && canManage && (
            <div className={row}>
              <span>
                <button type="button" onClick={() => void run("reopen")} disabled={busy !== null} className="inline-flex items-center gap-1.5 font-semibold text-link hover:underline disabled:opacity-50">
                  {busy === "reopen" && <Loader2 className="size-3.5 animate-spin" />}Reabrir el caso
                </button>
                <span className={cn("block", hint)}>Vuelve a quedar por decidir.</span>
              </span>
            </div>
          )}
          {error && <p role="alert" className="text-[13px] text-tone-err">{error}</p>}
        </>
      ) : (
        <>
          {steps.map((step) => (
            <div key={step.key} className={row}>
              <span className="flex flex-wrap items-baseline justify-between gap-2.5">
                <span><b className="font-semibold">{step.label}</b><span className="text-muted-foreground"> · {step.who}</span></span>
                {step.signed ? <StatusPill tone="ok">{step.signed}</StatusPill> : <StatusPill tone="warn">Pendiente</StatusPill>}
              </span>
            </div>
          ))}
          <div className={row}>
            {deciding ? (
              <DecisionForm caseId={caseId} caseTitle={caseTitle} blocked={verdict === "block"} allowOverride={allowOverride}
                openFindings={openFindings} requestsEnabled={requestsEnabled} onDecided={() => router.refresh()} />
            ) : (
              <span className="text-muted-foreground">
                {!canManage ? "Tu rol puede consultar el caso, no decidirlo."
                  : !approvalEnabled ? "Este caso no pasa por aprobación."
                  : "Este caso aún no está listo para decisión. Espera a que termine la validación."}
              </span>
            )}
          </div>
        </>
      )}
    </section>
  );
}
