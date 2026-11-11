"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { btn, type BtnVariant } from "@/components/kit";

/** POST a una acción del documento; al terminar refresca la página para mostrar el nuevo estado. */
function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "err" | "info"; text: string } | null>(null);
  async function run(key: string, url: string, body: unknown, after?: (data: Record<string, unknown>) => string | null) {
    setBusy(key); setMessage(null);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setMessage({ tone: "err", text: data.error ?? "No se pudo completar la acción." }); return; }
      const info = after?.(data) ?? null;
      if (info) setMessage({ tone: "info", text: info });
      router.refresh();
    } catch {
      setMessage({ tone: "err", text: "No se pudo conectar con el servidor." });
    } finally {
      setBusy(null);
    }
  }
  return { busy, message, run };
}

function Btn({ variant, busy, disabled, onClick, children }: { variant: BtnVariant; busy: boolean; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" className={btn(variant)} disabled={disabled} onClick={onClick}>{busy && <Loader2 className="animate-spin" />}{children}</button>;
}

function Message({ m }: { m: { tone: "err" | "info"; text: string } | null }) {
  if (!m) return null;
  return <p role={m.tone === "err" ? "alert" : "status"} className={m.tone === "err" ? "basis-full text-sm text-tone-err" : "basis-full text-sm text-muted-foreground"}>{m.text}</p>;
}

/** «Aprobar y enviar al ERP» para quien puede aprobar. */
export function ApproveAction({ docId }: { docId: number }) {
  const a = useAction();
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Btn variant="primary" busy={a.busy === "approve"} disabled={a.busy !== null}
        onClick={() => a.run("approve", `/api/v1/workflow/${docId}/approve`, { _approval: true })}>
        Aprobar y enviar al ERP
      </Btn>
      <Message m={a.message} />
    </div>
  );
}

/** Esperando recepción: revisar ya o pasar a revisión manual. */
export function ReceiptActions({ docId }: { docId: number }) {
  const a = useAction();
  const after = (d: Record<string, unknown>) => (d.status === "awaiting_receipt" ? `Aún falta recepción${d.reason ? `: ${String(d.reason)}` : ""}.` : null);
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Btn variant="secondary" busy={a.busy === "manual"} disabled={a.busy !== null} onClick={() => a.run("manual", `/api/v1/workflow/${docId}/receipt`, { action: "manual" })}>Pasar a revisión manual</Btn>
      <Btn variant="primary" busy={a.busy === "check"} disabled={a.busy !== null} onClick={() => a.run("check", `/api/v1/workflow/${docId}/receipt`, { action: "check" }, after)}>Revisar ahora</Btn>
      <Message m={a.message} />
    </div>
  );
}

/** Error al enviar: reintentar o marcar resuelto (a través de su excepción). */
export function FailedActions({ exceptionId, canRetry }: { exceptionId: number; canRetry: boolean }) {
  const a = useAction();
  return (
    <div className="flex flex-col gap-0">
      {canRetry && (
        <Way title="Reintentar" hint="Útil si ya corrigieron el dato en el ERP. Se usa el mismo identificador; no se duplica.">
          <Btn variant="primary" busy={a.busy === "retry"} disabled={a.busy !== null} onClick={() => a.run("retry", `/api/v1/exceptions/${exceptionId}/retry`, {})}>Reintentar</Btn>
        </Way>
      )}
      <Way title="Marcar como resuelto" hint="Si ya la registraron a mano en el ERP.">
        <Btn variant="text" busy={a.busy === "resolve"} disabled={a.busy !== null} onClick={() => a.run("resolve", `/api/v1/exceptions/${exceptionId}/resolve`, {})}>Marcar resuelto</Btn>
      </Way>
      <Message m={a.message} />
    </div>
  );
}

function Way({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line-soft py-3.5 last:border-0">
      <span className="min-w-0 max-w-xl"><b className="block font-semibold">{title}</b><span className="text-[12.5px] text-muted-foreground">{hint}</span></span>
      {children}
    </div>
  );
}

/** Refresca la página mientras el documento se lee o se envía. */
export function AutoRefresh({ seconds = 4 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}
