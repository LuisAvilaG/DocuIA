"use client";

// La decisión del caso, al lado del resumen de lo que se aprueba: quién debe
// aprobar, el comentario y los dos botones. Aprobar sin bloqueos y rechazar se
// resuelven aquí; la excepción (marcar cada validación, adjuntar soporte) y
// pedir documentos corregidos siguen en su diálogo, que abre con lo ya escrito.
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { btn, StatusPill } from "@/components/kit";
import { DecisionDialog, type CaseDecisionAction } from "../components/decision-dialog";
import { CaseActions } from "./actions";

interface Decision { action?: string; reason?: string | null; byEmail?: string | null; at?: string | null; override?: boolean; support?: { name?: string } }
export interface DecisionStep { key: string; label: string; who: string; signed: string | null }

export function DecisionPanel({ caseId, caseTitle, status, verdict, decision, hasOutput, generationEnabled, approvalEnabled, allowOverride, canManage, steps, openFindings, requestsEnabled }: {
  caseId: string;
  caseTitle: string;
  status: string;
  verdict?: "ok" | "warn" | "block" | null;
  decision?: Decision | null;
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
  const [busy, setBusy] = useState<CaseDecisionAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The approval was recorded but another one is still missing (its name).
  const [partial, setPartial] = useState<string | null>(null);
  const [dialog, setDialog] = useState<CaseDecisionAction | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  const decided = status === "approved" || status === "rejected" || (status === "generated" && decision?.action === "approve");
  const blocked = verdict === "block";
  const deciding = approvalEnabled && !decided && canManage && status === "validated";

  async function decide(action: CaseDecisionAction) {
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
      const response = await fetch(`/api/v1/contracts/cases/${caseId}/${action}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason, override: false }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setError(data.error ?? "No se pudo guardar la decisión. Intenta de nuevo."); return; }
      if (action === "approve" && data.status === "partial") setPartial(typeof data.pending === "string" && data.pending ? data.pending : "otra aprobación");
      setReason("");
      router.refresh();
    } catch {
      setError("No se pudo conectar con DocuIA. Revisa tu conexión e inténtalo de nuevo.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="dec-h" className="flex min-w-0 flex-[1_1_340px] flex-col gap-3.5 rounded-xl border border-border bg-white p-5 lg:max-w-[420px]">
      <h2 id="dec-h" className="text-[17px] font-semibold tracking-[-0.015em]">{decided ? "Decisión" : "Tu decisión"}</h2>
      {steps.map((step) => (
        <div key={step.key} className="flex flex-wrap items-center justify-between gap-2.5 rounded-[10px] border border-border bg-card px-3 py-2.5 text-[13.5px]">
          <span><b className="font-semibold">{step.label}</b><span className="text-muted-foreground"> · {step.who}</span></span>
          {step.signed ? <StatusPill tone="ok">{step.signed}</StatusPill> : <StatusPill tone="warn">Pendiente</StatusPill>}
        </div>
      ))}

      {deciding ? (
        <>
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
          {!blocked && openFindings > 0 && (
            <p className="text-[12.5px] text-muted-foreground">Vas a decidir con {openFindings} hallazgo{openFindings === 1 ? "" : "s"} sin resolver.</p>
          )}
          {error && <p role="alert" className="text-[13px] text-tone-err">{error}</p>}
          <div className="flex flex-wrap gap-2.5">
            {(!blocked || allowOverride) && (
              <button type="button" onClick={() => void decide("approve")} disabled={busy !== null} className={btn("primary", "md", "min-h-11 flex-[1_1_150px]")}>
                {busy === "approve" && <Loader2 className="animate-spin" />}{blocked ? "Aprobar con excepción" : "Aprobar"}
              </button>
            )}
            <button type="button" onClick={() => void decide("reject")} disabled={busy !== null} className={btn("danger", "md", "min-h-11 flex-[1_1_150px]")}>
              {busy === "reject" && <Loader2 className="animate-spin" />}Rechazar
            </button>
          </div>
        </>
      ) : (
        <>
          <CaseActions caseId={caseId} caseTitle={caseTitle} status={status} verdict={verdict} decision={decision} hasOutput={hasOutput} generationEnabled={generationEnabled} approvalEnabled={approvalEnabled} allowOverride={allowOverride} canManage={canManage} />
          {!decided && !canManage && <p className="text-[13px] text-muted-foreground">Tu rol puede consultar el caso, no decidirlo.</p>}
        </>
      )}

      {dialog && (
        <DecisionDialog caseId={caseId} caseTitle={caseTitle} action={dialog} blocked={blocked} allowOverride={allowOverride} initialReason={reason}
          onClose={() => setDialog(null)} onComplete={() => { setDialog(null); setReason(""); router.refresh(); }} />
      )}
    </section>
  );
}
