"use client";

// La decisión del caso, al lado del resumen de lo que se aprueba. Es una
// columna de renglones con línea fina, como el resumen: sin tarjeta ni
// recuadro dentro. Pendiente: quién debe aprobar, el comentario y los dos
// botones. Tomada: el estado, quién y cuándo, el siguiente paso y reabrir.
// Aprobar sin bloqueos y rechazar se resuelven aquí; la excepción (marcar cada
// validación, adjuntar soporte) y pedir documentos corregidos siguen en su
// diálogo, que abre con lo ya escrito.
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { btn, StatusPill } from "@/components/kit";
import { DecisionDialog, type CaseDecisionAction } from "../components/decision-dialog";

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
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<CaseDecisionAction | "generate" | "reopen" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The approval was recorded but another one is still missing (its name).
  const [partial, setPartial] = useState<string | null>(null);
  const [dialog, setDialog] = useState<CaseDecisionAction | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  const approved = status === "approved" || (status === "generated" && decision?.action === "approve");
  const rejected = status === "rejected";
  const decided = approved || rejected;
  const blocked = verdict === "block";
  const deciding = approvalEnabled && !decided && canManage && status === "validated";

  async function send(path: string): Promise<Record<string, unknown> | null> {
    const response = await fetch(`/api/v1/contracts/cases/${caseId}/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(path === "approve" || path === "reject" ? { reason, override: false } : {}) });
    const data = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) { setError(typeof data.error === "string" ? data.error : "No se pudo completar. Intenta de nuevo."); return null; }
    return data;
  }

  async function run(action: CaseDecisionAction | "generate" | "reopen") {
    setError(null);
    // An exception asks to mark every validation; a rejection may ask for documents instead.
    if ((action === "approve" && blocked) || (action === "reject" && requestsEnabled)) { setDialog(action); return; }
    if (action === "reject" && !reason.trim()) {
      setError("Escribe en el comentario por qué lo rechazas.");
      field.current?.focus();
      return;
    }
    setBusy(action);
    try {
      const data = await send(action);
      if (!data) return;
      if (action === "approve" && data.status === "partial") setPartial(typeof data.pending === "string" && data.pending ? data.pending : "otra aprobación");
      setReason("");
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
          {deciding ? (
            <div className={cn(row, "gap-3")}>
              {partial && <p role="status" className="rounded-lg bg-tone-ok-bg px-3 py-2 text-[13px]">Tu aprobación quedó registrada. Falta: <b className="font-semibold">{partial}</b>.</p>}
              {blocked && (
                <p className="text-[13px] text-tone-err">
                  {allowOverride
                    ? "El caso tiene bloqueos: solo se puede aprobar como excepción, confirmando cada validación."
                    : "La política de tu empresa no permite aprobar casos con bloqueos. Corrige los datos o rechaza el caso."}
                </p>
              )}
              <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-foreground/90">
                Comentario
                <textarea ref={field} rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
                  placeholder="Opcional al aprobar; al rechazar, di por qué."
                  className="min-h-[84px] w-full resize-y rounded-lg border border-[#D6D2C8] bg-white px-3 py-2.5 text-sm font-normal leading-normal outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
              </label>
              {!blocked && openFindings > 0 && <span className={hint}>Vas a decidir con {openFindings} hallazgo{openFindings === 1 ? "" : "s"} sin resolver.</span>}
              {error && <p role="alert" className="text-[13px] text-tone-err">{error}</p>}
              <div className="flex flex-wrap gap-2.5">
                {(!blocked || allowOverride) && (
                  <button type="button" onClick={() => void run("approve")} disabled={busy !== null} className={btn("primary", "md", "min-h-11 flex-[1_1_130px]")}>
                    {busy === "approve" && <Loader2 className="animate-spin" />}{blocked ? "Aprobar con excepción" : "Aprobar"}
                  </button>
                )}
                <button type="button" onClick={() => void run("reject")} disabled={busy !== null} className={btn("danger", "md", "min-h-11 flex-[1_1_130px]")}>
                  {busy === "reject" && <Loader2 className="animate-spin" />}Rechazar
                </button>
              </div>
            </div>
          ) : (
            <div className={row}>
              <span className="text-muted-foreground">
                {!canManage ? "Tu rol puede consultar el caso, no decidirlo."
                  : !approvalEnabled ? "Este caso no pasa por aprobación."
                  : "Este caso aún no está listo para decisión. Espera a que termine la validación."}
              </span>
            </div>
          )}
        </>
      )}

      {dialog && (
        <DecisionDialog caseId={caseId} caseTitle={caseTitle} action={dialog} blocked={blocked} allowOverride={allowOverride} initialReason={reason}
          onClose={() => setDialog(null)} onComplete={() => { setDialog(null); setReason(""); router.refresh(); }} />
      )}
    </section>
  );
}
