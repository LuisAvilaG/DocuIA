"use client";

// Decidir un caso: el comentario y los dos botones, en el caso y en
// Aprobaciones. Aprobar sin bloqueos y rechazar se resuelven aquí; la excepción
// (marcar cada validación, adjuntar soporte) y pedir documentos corregidos
// siguen en su diálogo, que abre con lo ya escrito.
import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { btn } from "@/components/kit";
import { DecisionDialog, type CaseDecisionAction } from "./decision-dialog";

export function DecisionForm({ caseId, caseTitle, blocked, allowOverride, openFindings, requestsEnabled, onDecided }: {
  caseId: string;
  caseTitle: string;
  /** The case has blocks: it can only be approved as an exception. */
  blocked: boolean;
  allowOverride: boolean;
  /** Findings still open (blocks and things to review). */
  openFindings: number;
  /** Rejecting can also ask the contractor for corrected documents. */
  requestsEnabled: boolean;
  /** The decision was recorded (also when another approval is still missing). */
  onDecided: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<CaseDecisionAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The approval was recorded but another one is still missing (its name).
  const [partial, setPartial] = useState<string | null>(null);
  const [dialog, setDialog] = useState<CaseDecisionAction | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  async function run(action: CaseDecisionAction) {
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
      const response = await fetch(`/api/v1/contracts/cases/${caseId}/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason, override: false }) });
      const data = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (!response.ok) { setError(typeof data.error === "string" ? data.error : "No se pudo guardar la decisión. Intenta de nuevo."); return; }
      if (action === "approve" && data.status === "partial") setPartial(typeof data.pending === "string" && data.pending ? data.pending : "otra aprobación");
      setReason("");
      onDecided();
    } catch {
      setError("No se pudo conectar con DocuIA. Revisa tu conexión e inténtalo de nuevo.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
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
      {!blocked && openFindings > 0 && <span className="text-[12.5px] text-muted-foreground">Vas a decidir con {openFindings} hallazgo{openFindings === 1 ? "" : "s"} sin resolver.</span>}
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

      {dialog && (
        <DecisionDialog caseId={caseId} caseTitle={caseTitle} action={dialog} blocked={blocked} allowOverride={allowOverride} initialReason={reason}
          onClose={() => setDialog(null)} onComplete={() => { setDialog(null); setReason(""); onDecided(); }} />
      )}
    </div>
  );
}
