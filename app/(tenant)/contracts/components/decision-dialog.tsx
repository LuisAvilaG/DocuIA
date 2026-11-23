"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Loader2, Upload, X } from "lucide-react";
import { btn } from "@/components/kit";
import { uploadContractFile } from "@/lib/contracts/upload-client";

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

interface Finding { id: number; severity: string | null; ruleName: string | null; subject: string; reason: string | null }
type Support = { status: "uploading"; name: string; progress: number } | { status: "done"; name: string; uploadId: string } | { status: "error"; name: string; error: string };

/**
 * Aprobar, aprobar con excepción o rechazar un caso. Con excepción (hay bloqueos):
 * cada validación sin resolver se marca como revisada, la justificación es
 * obligatoria y se puede adjuntar un soporte; todo queda en el registro.
 */
export function DecisionDialog({ caseId, caseTitle, action, blocked, allowOverride, onClose, onComplete }: Props) {
  const titleId = useId();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [support, setSupport] = useState<Support | null>(null);
  const done = useRef(false);
  // The approval was recorded but another one is still missing (its name).
  const [partial, setPartial] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const isApproval = action === "approve";
  // Pedir documentos corregidos (feature contract_document_requests), solo al rechazar.
  const [requests, setRequests] = useState<{ enabled: boolean; email: string | null; emailSource: "case" | "contract" | null; documents: string[] } | null>(null);
  const [mode, setMode] = useState<"request" | "reject">("request");
  const [email, setEmail] = useState("");
  const [askFor, setAskFor] = useState<Set<string>>(new Set());
  const [otherDoc, setOtherDoc] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (isApproval) return;
    fetch(`/api/v1/contracts/cases/${caseId}/request-documents`).then((r) => r.json())
      .then((d) => { setRequests(d.enabled ? d : { enabled: false, email: null, emailSource: null, documents: [] }); if (d.email) setEmail(d.email); })
      .catch(() => setRequests({ enabled: false, email: null, emailSource: null, documents: [] }));
  }, [caseId, isApproval]);
  const requesting = !isApproval && requests?.enabled === true && mode === "request";
  const exception = isApproval && blocked;
  const cannotApprove = exception && !allowOverride;

  useEffect(() => {
    if (!exception) return;
    fetch(`/api/v1/contracts/cases/${caseId}/findings`)
      .then((r) => r.json())
      .then((d) => setFindings(Array.isArray(d.findings) ? d.findings : []))
      .catch(() => setFindings([]));
  }, [caseId, exception]);

  // Un soporte subido que no se usó se libera al cerrar.
  const supportRef = useRef<Support | null>(null);
  useEffect(() => { supportRef.current = support; }, [support]);
  useEffect(() => () => {
    const s = supportRef.current;
    if (!done.current && s?.status === "done") void fetch(`/api/v1/contracts/uploads/${s.uploadId}`, { method: "DELETE" }).catch(() => undefined);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape" && !busy) (partial ? onComplete : onClose)(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose, onComplete, partial]);

  async function attach(file: File) {
    const prev = support;
    if (prev?.status === "done") void fetch(`/api/v1/contracts/uploads/${prev.uploadId}`, { method: "DELETE" }).catch(() => undefined);
    setSupport({ status: "uploading", name: file.name, progress: 0 });
    try {
      const uploadId = await uploadContractFile(file, (p) => setSupport({ status: "uploading", name: file.name, progress: p }));
      setSupport({ status: "done", name: file.name, uploadId });
    } catch (e) {
      setSupport({ status: "error", name: file.name, error: e instanceof Error ? e.message : "No se pudo subir" });
    }
  }

  const missingChecks = exception && findings ? findings.filter((f) => !checked.has(f.id)).length : 0;
  const reasonRequired = action === "reject" || exception;
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
  const disabled = busy || cannotApprove || (reasonRequired && !reason.trim()) || (exception && (findings === null || missingChecks > 0)) || support?.status === "uploading"
    || (requesting && !emailOk);
  const hint = cannotApprove ? null
    : exception && missingChecks > 0 ? `Falta marcar ${missingChecks} validaci${missingChecks === 1 ? "ón" : "ones"}`
    : reasonRequired && !reason.trim() ? (action === "reject" ? "Escribe el motivo" : "Escribe la justificación")
    : requesting && !emailOk ? "Falta el correo del contratista"
    : null;

  async function submit() {
    if (disabled) return;
    setBusy(true); setError(null);
    try {
      const response = requesting
        ? await fetch(`/api/v1/contracts/cases/${caseId}/request-documents`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim(), reason, message, documents: [...askFor, ...(otherDoc.trim() ? [otherDoc.trim()] : [])] }),
        })
        : await fetch(`/api/v1/contracts/cases/${caseId}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason,
          override: exception,
          ...(exception ? { acknowledged: [...checked] } : {}),
          ...(support?.status === "done" ? { supportUploadId: support.uploadId } : {}),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setError(data.error ?? "No se pudo guardar la decisión. Intenta de nuevo."); return; }
      done.current = true;
      // With several approvals the case is still to be decided: say so before
      // closing, instead of leaving as if it had been approved.
      if (isApproval && data.status === "partial") { setPartial(typeof data.pending === "string" && data.pending ? data.pending : "otra aprobación"); return; }
      onComplete();
    } catch {
      setError("No se pudo conectar con DocuIA. Revisa tu conexión e inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  const blocks = findings?.filter((f) => f.severity === "block") ?? [];
  const warns = findings?.filter((f) => f.severity !== "block") ?? [];
  const title = isApproval ? (exception ? "Aprobar con excepción" : "Aprobar caso") : requests?.enabled ? "¿Qué hacemos con el caso?" : "Rechazar caso";
  const submitLabel = requesting ? "Enviar y dejar en espera" : isApproval ? title : "Rechazar caso";

  if (partial) return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-[rgba(30,32,41,0.38)] px-4 py-16" onMouseDown={(e) => { if (e.target === e.currentTarget) onComplete(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby={titleId} className="flex w-full max-w-[520px] flex-col rounded-[14px] bg-card shadow-[0_24px_70px_rgba(30,32,41,0.25)]">
        <header className="border-b border-line-soft px-6 pb-3.5 pt-5.5">
          <p className="truncate text-[12.5px] text-muted-foreground">{caseTitle}</p>
          <h2 id={titleId} className="text-[19px] font-semibold tracking-[-0.02em]">Tu aprobación quedó registrada</h2>
        </header>
        <p className="px-6 py-5 text-sm">El caso todavía no está aprobado. Falta: <b className="font-semibold">{partial}</b>. Sigue en «Por decidir» hasta que se complete.</p>
        <footer className="flex justify-end border-t border-line-soft px-6 py-3.5">
          <button type="button" onClick={onComplete} className={btn("primary")}>Entendido</button>
        </footer>
      </section>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-[rgba(30,32,41,0.38)] px-4 py-16" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby={titleId} className="flex w-full max-w-[640px] flex-col rounded-[14px] bg-card shadow-[0_24px_70px_rgba(30,32,41,0.25)]">
        <header className="flex items-start justify-between gap-4 border-b border-line-soft px-6 pb-3.5 pt-5.5">
          <div className="min-w-0">
            <p className="truncate text-[12.5px] text-muted-foreground">{caseTitle}</p>
            <h2 id={titleId} className="text-[19px] font-semibold tracking-[-0.02em]">{title}</h2>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Cerrar" className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border text-foreground/70 hover:text-foreground"><X className="size-4" /></button>
        </header>

        <div className="flex flex-col gap-4 px-6 py-5">
          {cannotApprove ? (
            <p className="text-sm">La política de tu empresa no permite aprobar casos con bloqueos. Corrige los datos o rechaza el caso.</p>
          ) : exception ? (
            <>
              <p className="text-sm">El caso tiene validaciones sin resolver. Confirma que revisaste cada una; quedará registrado con tu nombre.</p>
              {findings === null ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Cargando validaciones…</p>
              ) : (
                <div>
                  {[["Bloquea", blocks], ["Por revisar", warns]].map(([label, list]) => (list as Finding[]).length > 0 && (
                    <fieldset key={label as string} className="mb-3">
                      <legend className="mb-1.5 text-xs font-semibold uppercase tracking-[0.05em] text-foreground/75">{label as string} · {(list as Finding[]).length}</legend>
                      {(list as Finding[]).map((f) => (
                        <label key={f.id} className="flex cursor-pointer items-start gap-2.5 border-b border-line-soft py-2 text-[13.5px] last:border-0">
                          <input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={checked.has(f.id)}
                            onChange={(e) => setChecked((cur) => { const next = new Set(cur); if (e.target.checked) next.add(f.id); else next.delete(f.id); return next; })} />
                          <span><b className="font-semibold">{f.ruleName ?? f.subject}</b>{f.reason ? ` · ${f.reason}` : f.ruleName ? ` · ${f.subject}` : ""}</span>
                        </label>
                      ))}
                    </fieldset>
                  ))}
                </div>
              )}
            </>
          ) : !isApproval && requests?.enabled ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="sr-only">Tipo de rechazo</legend>
              {([["request", "Pedir documentos corregidos", "El caso queda abierto. Cuando suban la nueva versión, se vuelve a analizar."], ["reject", "Rechazar definitivamente", "El caso se cierra como Rechazado. No se genera el documento."]] as const).map(([k, t, d]) => (
                <label key={k} className={`flex cursor-pointer items-start gap-2.5 rounded-[10px] border px-3.5 py-3 text-[13.5px] ${mode === k ? "border-primary bg-tone-info-bg/50" : "border-border"}`}>
                  <input type="radio" name="reject-mode" className="mt-0.5 accent-primary" checked={mode === k} onChange={() => setMode(k)} />
                  <span><b className="block font-semibold">{t}</b><span className="text-[13px] text-muted-foreground">{d}</span></span>
                </label>
              ))}
            </fieldset>
          ) : (
            <p className="text-sm">Vas a {isApproval ? "aprobar" : "rechazar"} este caso.{!isApproval && " El motivo queda en el registro."}</p>
          )}

          {!cannotApprove && (
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-semibold text-foreground/90">
                {requesting ? "Motivo" : action === "reject" ? "Motivo del rechazo" : exception ? "Justificación" : "Comentario"} <span className="font-normal text-muted-foreground">· {reasonRequired ? "obligatorio" : "opcional"}</span>
              </span>
              <textarea rows={4} value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder={action === "reject" ? "Ej. Falta confirmar el alcance de la póliza." : exception ? "Ej. El consorcio entregó el poder (escritura 1.204 del 2 de marzo)." : "Ej. Revisado con el responsable del contrato."}
                className="min-h-24 rounded-lg border border-[#D6D2C8] bg-white px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
            </label>
          )}

          {requesting && requests && (
            <>
              {requests.documents.length > 0 && (
                <fieldset>
                  <legend className="mb-1.5 text-xs font-semibold uppercase tracking-[0.05em] text-foreground/75">Qué documentos pedir</legend>
                  {requests.documents.map((d) => (
                    <label key={d} className="flex cursor-pointer items-center gap-2.5 py-1 text-[13.5px]">
                      <input type="checkbox" className="size-4 accent-primary" checked={askFor.has(d)} onChange={(e) => setAskFor((cur) => { const n = new Set(cur); if (e.target.checked) n.add(d); else n.delete(d); return n; })} />{d} corregido
                    </label>
                  ))}
                  <input value={otherDoc} onChange={(e) => setOtherDoc(e.target.value)} placeholder="Otro documento (opcional)" className="mt-1.5 min-h-9 w-full rounded-lg border border-[#D6D2C8] bg-white px-3 text-[13px] outline-none focus:border-primary" />
                </fieldset>
              )}
              <label className="flex flex-col gap-1.5">
                <span className="text-[13px] font-semibold text-foreground/90">Correo del contratista {requests.emailSource === "contract" && <span className="font-normal text-tone-warn">· leído del contrato, confírmalo</span>}</span>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nombre@empresa.com" className="min-h-10 rounded-lg border border-[#D6D2C8] bg-white px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[13px] font-semibold text-foreground/90">Mensaje <span className="font-normal text-muted-foreground">· opcional</span></span>
                <textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Hola. Para continuar necesitamos…" className="rounded-lg border border-[#D6D2C8] bg-white px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
              </label>
            </>
          )}

          {exception && !cannotApprove && (
            <div className="flex flex-wrap items-center gap-2.5">
              <button type="button" className={btn("secondary", "sm")} onClick={() => fileInput.current?.click()} disabled={support?.status === "uploading"}><Upload />{support ? "Cambiar soporte" : "Adjuntar soporte"}</button>
              {support && (
                <span className="rounded-md bg-tone-mute-bg px-2 py-0.5 text-xs text-foreground/80">
                  {support.name}{support.status === "uploading" ? ` · ${Math.round(support.progress * 100)} %` : support.status === "error" ? ` · ${support.error}` : ""}
                </span>
              )}
              <span className="text-xs text-muted-foreground">Opcional · un poder, un anexo o un correo que respalde la excepción</span>
              <input ref={fileInput} type="file" accept=".pdf,.docx,.jpg,.jpeg,.png,.webp,.tiff,.txt" className="sr-only" tabIndex={-1} onChange={(e) => { const f = e.target.files?.[0]; if (f) void attach(f); e.target.value = ""; }} />
            </div>
          )}
          {error && <p role="alert" className="text-sm text-tone-err">{error}</p>}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line-soft px-6 py-3.5">
          <span className="text-[12.5px] text-muted-foreground">{hint}</span>
          <span className="flex gap-2">
            <button type="button" onClick={onClose} disabled={busy} className={btn("secondary")}>Cancelar</button>
            {!cannotApprove && (
              <button type="button" onClick={submit} disabled={disabled} className={btn(isApproval || requesting ? "primary" : "danger")}>
                {busy && <Loader2 className="animate-spin" />}{submitLabel}
              </button>
            )}
          </span>
        </footer>
      </section>
    </div>
  );
}
