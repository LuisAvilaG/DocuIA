"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, ShieldX, X, XCircle } from "lucide-react";

export type CaseDecisionAction = "approve" | "reject";

type Props = {
  caseId: string;
  caseTitle: string;
  action: CaseDecisionAction;
  blocked: boolean;
  allowOverride: boolean;
  onClose: () => void;
  onComplete: () => void;
};

export function DecisionDialog({ caseId, caseTitle, action, blocked, allowOverride, onClose, onComplete }: Props) {
  const [reason, setReason] = useState("");
  const [override, setOverride] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isApproval = action === "approve";
  const cannotApprove = isApproval && blocked && !allowOverride;
  const reasonRequired = action === "reject" || (isApproval && blocked);
  const disabled = busy || cannotApprove || (reasonRequired && !reason.trim()) || (isApproval && blocked && !override);

  async function submit() {
    if (disabled) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/contracts/cases/${caseId}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason, override }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? "No se pudo guardar la decisión. Intenta de nuevo.");
        return;
      }
      onComplete();
    } catch {
      setError("No se pudo conectar con DocuIA. Revisa tu conexión e inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-foreground/30 p-4" onMouseDown={onClose}>
      <section role="dialog" aria-modal="true" aria-labelledby="case-decision-title" className="w-full max-w-md rounded-xl border border-border bg-card shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <header className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.06em] text-muted-foreground">Decisión administrativa</p>
            <h2 id="case-decision-title" className="mt-0.5 text-sm font-semibold text-foreground">{isApproval ? "Aprobar caso" : "Rechazar caso"}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar decisión" className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"><X className="h-4 w-4" /></button>
        </header>
        <div className="space-y-4 px-5 py-4">
          <p className="text-xs leading-relaxed text-muted-foreground">Vas a {isApproval ? "aprobar" : "rechazar"} <span className="font-medium text-foreground">{caseTitle}</span>.</p>
          {isApproval && blocked && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3">
              <div className="flex items-start gap-2 text-destructive">
                <ShieldX className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="text-xs font-semibold">Hay validaciones bloqueantes.</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-foreground/80">
                    {allowOverride
                      ? "Solo puedes aprobarlo como excepción. La justificación quedará en el historial del caso."
                      : "La política de este cliente no permite aprobar casos con bloqueos. Corrige los datos o rechaza el caso."}
                  </p>
                </div>
              </div>
              {allowOverride && (
                <label className="mt-3 flex cursor-pointer items-start gap-2 text-[11px] leading-relaxed text-foreground">
                  <input type="checkbox" checked={override} onChange={(event) => setOverride(event.target.checked)} className="mt-0.5 h-3.5 w-3.5 accent-primary" />
                  <span>Confirmo que apruebo una excepción pese a los bloqueos.</span>
                </label>
              )}
            </div>
          )}
          <label className="block space-y-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">
              {action === "reject" ? "Motivo del rechazo" : blocked ? "Justificación de la excepción" : "Comentario"}{reasonRequired ? " (obligatorio)" : " (opcional)"}
            </span>
            <textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} disabled={cannotApprove}
              placeholder={action === "reject" ? "Ej. Falta confirmar el alcance de la póliza." : blocked ? "Ej. El cliente autorizó la diferencia por escrito." : "Ej. Revisado con el responsable del contrato."}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:cursor-not-allowed disabled:bg-secondary disabled:text-muted-foreground" />
          </label>
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        </div>
        <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">Cancelar</button>
          {!cannotApprove && <button type="button" onClick={submit} disabled={disabled}
            className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-medium text-primary-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${isApproval ? "bg-success hover:bg-success/90" : "bg-destructive hover:bg-destructive/90"}`}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : isApproval ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
            {isApproval ? (blocked ? "Aprobar excepción" : "Aprobar caso") : "Rechazar caso"}
          </button>}
        </footer>
      </section>
    </div>
  );
}
