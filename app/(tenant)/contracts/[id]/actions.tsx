"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, FileDown, CheckCircle2, XCircle, ShieldX, RotateCcw } from "lucide-react";
import { DecisionDialog, type CaseDecisionAction } from "../components/decision-dialog";

interface Decision { action?: string; reason?: string | null; byEmail?: string | null; at?: string | null; override?: boolean }

export function CaseActions({ caseId, caseTitle, status, verdict, decision, hasOutput, generationEnabled, approvalEnabled, allowOverride, canManage }: {
  caseId: string;
  caseTitle: string;
  status: string;
  verdict?: "ok" | "warn" | "block" | null;
  decision?: Decision | null;
  hasOutput: boolean;
  generationEnabled: boolean;
  approvalEnabled: boolean;
  allowOverride: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<CaseDecisionAction | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const isApproved = status === "approved" || (status === "generated" && decision?.action === "approve");
  const isRejected = status === "rejected";
  const decided = isApproved || isRejected;
  const blocked = verdict === "block";
  const canGenerate = generationEnabled && canManage && (approvalEnabled ? isApproved : status === "validated");

  async function post(path: string, label: string, body?: Record<string, unknown>) {
    setBusy(label); setMsg(null);
    try {
      const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg(d.error ?? "Error"); return; }
      if (d.downloadPath) window.open(d.downloadPath, "_blank");
      setDialog(null);
      router.refresh();
    } catch { setMsg("Sin conexión"); }
    finally { setBusy(null); }
  }

  const genBtn = canGenerate ? (
    <button onClick={() => post(`/api/v1/contracts/cases/${caseId}/generate`, "gen")} disabled={!!busy}
      className="inline-flex items-center gap-2 rounded-lg bg-secondary text-foreground px-3 py-1.5 text-xs font-medium disabled:opacity-60 hover:bg-secondary/70 transition-colors">
      {busy === "gen" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />} {hasOutput ? "Regenerar documento" : "Generar documento"}
    </button>
  ) : null;

  if (decided) {
    const ok = isApproved;
    return (
      <div className="space-y-2.5">
        <div className={`rounded-xl border px-4 py-3 ${ok ? "bg-success/10 border-success/20" : "bg-destructive/10 border-destructive/20"}`}>
          <div className="flex items-center gap-2 flex-wrap">
            {ok ? <CheckCircle2 className="w-4 h-4 text-success shrink-0" /> : <XCircle className="w-4 h-4 text-destructive shrink-0" />}
            <p className={`text-xs font-medium ${ok ? "text-success" : "text-destructive"}`}>
              {ok ? "Aprobado" : "Rechazado"}{decision?.byEmail ? ` por ${decision.byEmail}` : ""}{decision?.at ? ` · ${new Date(decision.at).toLocaleString("es-MX")}` : ""}
            </p>
            {decision?.override && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-destructive/10 text-destructive">forzado pese a bloqueos</span>}
          </div>
          {decision?.reason && <p className="text-[11px] text-muted-foreground mt-1.5 break-words">“{decision.reason}”</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {genBtn}
          {approvalEnabled && canManage && <button onClick={() => post(`/api/v1/contracts/cases/${caseId}/reopen`, "reopen")} disabled={!!busy}
            className="inline-flex items-center gap-2 rounded-lg border border-border text-muted-foreground px-3 py-1.5 text-xs font-medium disabled:opacity-60 hover:text-foreground hover:bg-secondary transition-colors">
            {busy === "reopen" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />} Reabrir
          </button>}
          {msg && <span className="text-xs text-destructive">{msg}</span>}
        </div>
      </div>
    );
  }

  if (!canManage) return null;

  const readyForDecision = status === "validated";

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {approvalEnabled && !readyForDecision && (
          <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
            Este caso aún no está listo para decisión. Espera a que termine la validación.
          </div>
        )}
        {!approvalEnabled && generationEnabled && status !== "validated" && (
          <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground">La generación estará disponible cuando termine la validación.</div>
        )}
        {approvalEnabled && readyForDecision && blocked && (
          <div className="w-full rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-xs text-foreground">
            <div className="flex items-center gap-2 font-medium text-destructive"><ShieldX className="h-3.5 w-3.5" /> Caso con bloqueos</div>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{allowOverride ? "Revisa los hallazgos. Puedes rechazarlo o aprobarlo como excepción con una justificación." : "Corrige los datos extraídos o rechaza el caso. Este tenant no permite excepciones."}</p>
          </div>
        )}
        {!approvalEnabled && genBtn}
        {approvalEnabled && readyForDecision && (!blocked || allowOverride) && <button onClick={() => { setMsg(null); setDialog("approve"); }} disabled={!!busy}
          className="inline-flex items-center gap-2 rounded-lg bg-success/15 text-success px-3 py-1.5 text-xs font-medium disabled:opacity-60 hover:bg-success/25 transition-colors">
          <CheckCircle2 className="w-3.5 h-3.5" /> {blocked ? "Aprobar con excepción" : "Aprobar"}
        </button>}
        {approvalEnabled && readyForDecision && <button onClick={() => { setMsg(null); setDialog("reject"); }} disabled={!!busy}
          className="inline-flex items-center gap-2 rounded-lg bg-destructive/10 text-destructive px-3 py-1.5 text-xs font-medium disabled:opacity-60 hover:bg-destructive/20 transition-colors">
          <XCircle className="w-3.5 h-3.5" /> Rechazar
        </button>}
        {msg && !dialog && <span className="text-xs text-destructive">{msg}</span>}
      </div>

      {dialog && <DecisionDialog caseId={caseId} caseTitle={caseTitle} action={dialog} blocked={blocked} allowOverride={allowOverride} onClose={() => setDialog(null)} onComplete={() => { setDialog(null); router.refresh(); }} />}
    </>
  );
}
