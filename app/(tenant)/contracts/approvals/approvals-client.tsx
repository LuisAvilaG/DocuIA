"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Loader2, CheckCircle2, XCircle, ShieldX, ShieldAlert, ShieldCheck, ClipboardCheck, ArrowRight, X,
} from "lucide-react";

export interface PendingCase {
  id: string; title: string; status: string; createdAt: string;
  verdict: "ok" | "warn" | "block" | null; validations: number;
}

const VERDICT = {
  ok:    { Icon: ShieldCheck, cls: "bg-success/10 text-success", text: "Sin observaciones" },
  warn:  { Icon: ShieldAlert, cls: "bg-warning/10 text-warning", text: "Con advertencias" },
  block: { Icon: ShieldX,     cls: "bg-destructive/10 text-destructive", text: "Con bloqueos" },
};

export function ApprovalsClient({ cases }: { cases: PendingCase[] }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<{ id: string; action: "approve" | "reject"; blocked: boolean } | null>(null);
  const [reason, setReason] = useState("");
  const [override, setOverride] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit() {
    if (!dialog) return;
    setBusy(true); setMsg(null);
    try {
      const path = `/api/v1/contracts/cases/${dialog.id}/${dialog.action}`;
      const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason, override }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg(d.error ?? "Error"); return; }
      setDialog(null); setReason(""); setOverride(false);
      router.refresh();
    } catch { setMsg("Sin conexión"); }
    finally { setBusy(false); }
  }

  const confirmDisabled = busy || (dialog?.action === "reject" && !reason.trim()) || (dialog?.action === "approve" && dialog.blocked && (!override || !reason.trim()));

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-5">
        <div>
          <h1 className="text-base font-semibold tracking-[-0.01em] text-foreground">Aprobaciones</h1>
          <p className="text-xs text-muted-foreground mt-1">{cases.length} caso(s) pendiente(s) de decisión.</p>
        </div>

        {cases.length === 0 ? (
          <div className="bg-card border border-border rounded-xl p-10 text-center">
            <div className="w-11 h-11 rounded-lg bg-primary/10 text-primary flex items-center justify-center mx-auto"><ClipboardCheck className="w-5 h-5" /></div>
            <p className="text-sm font-medium text-foreground mt-3">Todo al día</p>
            <p className="text-xs text-muted-foreground mt-1">No hay casos pendientes de aprobar.</p>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-xl overflow-hidden divide-y divide-border">
            {cases.map((c) => {
              const v = c.verdict ? VERDICT[c.verdict] : null;
              return (
                <div key={c.id} className="flex items-center gap-3 px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link href={`/contracts/${c.id}`} className="text-sm font-medium text-foreground truncate hover:text-primary transition-colors">{c.title}</Link>
                      {v && <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${v.cls}`}><v.Icon className="w-3 h-3" /> {v.text}</span>}
                    </div>
                    <p className="text-[11px] text-muted-foreground tabular-nums mt-0.5">{new Date(c.createdAt).toLocaleString("es-MX")} · {c.validations} validación(es)</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button onClick={() => { setReason(""); setOverride(false); setMsg(null); setDialog({ id: c.id, action: "approve", blocked: c.verdict === "block" }); }}
                      className="inline-flex items-center gap-1 rounded-md bg-success/15 text-success px-2.5 py-1.5 text-[11px] font-medium hover:bg-success/25 transition-colors"><CheckCircle2 className="w-3.5 h-3.5" /> Aprobar</button>
                    <button onClick={() => { setReason(""); setMsg(null); setDialog({ id: c.id, action: "reject", blocked: c.verdict === "block" }); }}
                      className="inline-flex items-center gap-1 rounded-md bg-destructive/10 text-destructive px-2.5 py-1.5 text-[11px] font-medium hover:bg-destructive/20 transition-colors"><XCircle className="w-3.5 h-3.5" /> Rechazar</button>
                    <Link href={`/contracts/${c.id}`} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary" title="Ver caso"><ArrowRight className="w-3.5 h-3.5" /></Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {dialog && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onMouseDown={() => setDialog(null)}>
          <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-md" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <p className="text-sm font-semibold text-foreground">{dialog.action === "approve" ? "Aprobar caso" : "Rechazar caso"}</p>
              <button onClick={() => setDialog(null)} className="h-7 w-7 flex items-center justify-center rounded hover:bg-secondary text-muted-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4 space-y-3">
              {dialog.action === "approve" && dialog.blocked && (
                <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2.5">
                  <div className="flex items-center gap-2 text-destructive"><ShieldX className="w-4 h-4 shrink-0" /><p className="text-xs font-medium">Este caso tiene validaciones bloqueantes.</p></div>
                  <label className="flex items-start gap-2 mt-2 text-[11px] text-foreground">
                    <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} className="mt-0.5" />
                    Aprobar de todas formas (queda registrado que se forzó).
                  </label>
                </div>
              )}
              <label className="block space-y-1">
                <span className="text-[11px] font-medium text-muted-foreground">{dialog.action === "reject" ? "Motivo del rechazo (obligatorio)" : dialog.blocked ? "Motivo del override (obligatorio)" : "Comentario (opcional)"}</span>
                <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
                  placeholder={dialog.action === "reject" ? "Ej. Falta la firma de un representante." : "Ej. Cliente confirmó por otro medio."}
                  className="w-full bg-background border border-border rounded-md px-2.5 py-2 text-xs text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15" />
              </label>
              {msg && <p className="text-xs text-destructive">{msg}</p>}
            </div>
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
              <button onClick={() => setDialog(null)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary">Cancelar</button>
              <button onClick={submit} disabled={confirmDisabled}
                className={`inline-flex items-center gap-2 rounded-lg px-4 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50 ${dialog.action === "approve" ? "bg-success" : "bg-destructive"}`}>
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : dialog.action === "approve" ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                {dialog.action === "approve" ? "Aprobar" : "Rechazar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
