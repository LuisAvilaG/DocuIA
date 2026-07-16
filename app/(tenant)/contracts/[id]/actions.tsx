"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, FileDown, CheckCircle2, XCircle, ShieldX, RotateCcw, X } from "lucide-react";

interface Decision { action?: string; reason?: string | null; byEmail?: string | null; at?: string | null; override?: boolean }

export function CaseActions({ caseId, status, verdict, decision }: {
  caseId: string; status: string; verdict?: "ok" | "warn" | "block" | null; decision?: Decision | null;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<null | "approve" | "reject">(null);
  const [reason, setReason] = useState("");
  const [override, setOverride] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const decided = status === "approved" || status === "rejected";
  const blocked = verdict === "block";

  async function post(path: string, label: string, body?: Record<string, unknown>) {
    setBusy(label); setMsg(null);
    try {
      const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg(d.error ?? "Error"); return; }
      if (d.downloadPath) window.open(d.downloadPath, "_blank");
      setDialog(null); setReason(""); setOverride(false);
      router.refresh();
    } catch { setMsg("Sin conexión"); }
    finally { setBusy(null); }
  }

  const genBtn = (
    <button onClick={() => post(`/api/v1/contracts/cases/${caseId}/generate`, "gen")} disabled={!!busy}
      className="inline-flex items-center gap-2 rounded-lg bg-secondary text-foreground px-3 py-1.5 text-xs font-medium disabled:opacity-60 hover:bg-secondary/70 transition-colors">
      {busy === "gen" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />} Generar documento
    </button>
  );

  if (decided) {
    const ok = status === "approved";
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
          <button onClick={() => post(`/api/v1/contracts/cases/${caseId}/reopen`, "reopen")} disabled={!!busy}
            className="inline-flex items-center gap-2 rounded-lg border border-border text-muted-foreground px-3 py-1.5 text-xs font-medium disabled:opacity-60 hover:text-foreground hover:bg-secondary transition-colors">
            {busy === "reopen" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />} Reabrir
          </button>
          {msg && <span className="text-xs text-destructive">{msg}</span>}
        </div>
      </div>
    );
  }

  const confirmDisabled = busy != null || (dialog === "reject" && !reason.trim()) || (dialog === "approve" && blocked && (!override || !reason.trim()));

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {genBtn}
        <button onClick={() => { setReason(""); setOverride(false); setMsg(null); setDialog("approve"); }} disabled={!!busy}
          className="inline-flex items-center gap-2 rounded-lg bg-success/15 text-success px-3 py-1.5 text-xs font-medium disabled:opacity-60 hover:bg-success/25 transition-colors">
          <CheckCircle2 className="w-3.5 h-3.5" /> Aprobar
        </button>
        <button onClick={() => { setReason(""); setMsg(null); setDialog("reject"); }} disabled={!!busy}
          className="inline-flex items-center gap-2 rounded-lg bg-destructive/10 text-destructive px-3 py-1.5 text-xs font-medium disabled:opacity-60 hover:bg-destructive/20 transition-colors">
          <XCircle className="w-3.5 h-3.5" /> Rechazar
        </button>
        {msg && !dialog && <span className="text-xs text-destructive">{msg}</span>}
      </div>

      {dialog && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onMouseDown={() => setDialog(null)}>
          <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-md" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <p className="text-sm font-semibold text-foreground">{dialog === "approve" ? "Aprobar caso" : "Rechazar caso"}</p>
              <button onClick={() => setDialog(null)} className="h-7 w-7 flex items-center justify-center rounded hover:bg-secondary text-muted-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4 space-y-3">
              {dialog === "approve" && blocked && (
                <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2.5">
                  <div className="flex items-center gap-2 text-destructive"><ShieldX className="w-4 h-4 shrink-0" /><p className="text-xs font-medium">Este caso tiene validaciones bloqueantes.</p></div>
                  <label className="flex items-start gap-2 mt-2 text-[11px] text-foreground">
                    <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} className="mt-0.5" />
                    Aprobar de todas formas (queda registrado que se forzó la aprobación).
                  </label>
                </div>
              )}
              <label className="block space-y-1">
                <span className="text-[11px] font-medium text-muted-foreground">
                  {dialog === "reject" ? "Motivo del rechazo (obligatorio)" : blocked ? "Motivo del override (obligatorio)" : "Comentario (opcional)"}
                </span>
                <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
                  placeholder={dialog === "reject" ? "Ej. Falta la firma de un representante." : "Ej. Cliente confirmó por otro medio."}
                  className="w-full bg-background border border-border rounded-md px-2.5 py-2 text-xs text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15" />
              </label>
              {msg && <p className="text-xs text-destructive">{msg}</p>}
            </div>
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
              <button onClick={() => setDialog(null)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary">Cancelar</button>
              <button
                onClick={() => dialog === "approve"
                  ? post(`/api/v1/contracts/cases/${caseId}/approve`, "confirm", { reason, override })
                  : post(`/api/v1/contracts/cases/${caseId}/reject`, "confirm", { reason })}
                disabled={confirmDisabled}
                className={`inline-flex items-center gap-2 rounded-lg px-4 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50 ${dialog === "approve" ? "bg-success" : "bg-destructive"}`}>
                {busy === "confirm" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : dialog === "approve" ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                {dialog === "approve" ? "Aprobar" : "Rechazar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
