"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { FlaskConical, Loader2, ExternalLink, AlertCircle } from "lucide-react";
import type { TestSend } from "@/lib/workflow/test-send";

interface Props {
  docId: number;
  /** Review screen: the draft as currently edited. Null means "use the stored draft". */
  buildBody?: () => Record<string, unknown> | null;
  history?: TestSend[];
  disabled?: boolean;
  compact?: boolean;
}

/**
 * "Enviar prueba a sandbox": creates the document in the ERP sandbox with a
 * fresh external id and a suffixed number, without touching the workflow.
 * Only rendered when the admin granted the feature and the active ERP
 * environment is sandbox (the API enforces both again).
 */
export function SandboxTestSend({ docId, buildBody, history = [], disabled = false, compact = false }: Props) {
  const [sends, setSends] = useState<TestSend[]>(history);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [last, setLast] = useState<TestSend | null>(null);

  async function send() {
    setError("");
    setLoading(true);
    try {
      const body = buildBody ? buildBody() : {};
      if (buildBody && body === null) { setError("Completa proveedor y al menos una línea antes de enviar la prueba."); return; }
      const res = await fetch(`/api/v1/workflow/${docId}/test-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "No se pudo enviar la prueba"); return; }
      setSends(data.history ?? [...sends, data.sent]);
      setLast(data.sent);
    } catch {
      setError("No se pudo conectar al servidor");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={cn("flex flex-col gap-2", compact ? "" : "rounded-xl border border-border bg-card p-4")}>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => { void send(); }}
          disabled={disabled || loading}
          className="h-9 px-3 inline-flex items-center gap-2 rounded-lg border text-[0.8125rem] font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          style={{ color: "oklch(0.50 0.14 80)", borderColor: "oklch(0.75 0.12 80 / 0.45)", backgroundColor: "oklch(0.97 0.03 80)" }}
          title="Crea la factura en el sandbox del ERP con otro id externo, aunque ya exista"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FlaskConical className="w-3.5 h-3.5" />}
          {loading ? "Enviando prueba…" : `Enviar prueba a sandbox${sends.length ? ` (${sends.length})` : ""}`}
        </button>
        {!compact && (
          <p className="text-xs text-muted-foreground flex-1 min-w-[220px]">
            Se crea en sandbox con un id de prueba y el sufijo <span className="font-mono">-PRUEBA{sends.length + 1}</span>. No cambia el estado del documento.
          </p>
        )}
      </div>
      {error && (
        <p className="text-xs text-destructive flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5 shrink-0" />{error}</p>
      )}
      {last && (
        <p className="text-xs flex items-center gap-2" style={{ color: "oklch(0.45 0.14 162)" }}>
          Prueba #{last.seq} creada{last.documentNumber ? ` como ${last.documentNumber}` : ""}{last.internalId ? ` · ID ${last.internalId}` : ""}.
          {last.recordUrl && (
            <a href={last.recordUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2">
              <ExternalLink className="w-3 h-3" /> Ver en el ERP
            </a>
          )}
        </p>
      )}
      {!compact && sends.length > 0 && (
        <ul className="mt-1 divide-y divide-border/60 text-xs">
          {sends.slice().reverse().map((s) => (
            <li key={s.externalId} className="flex items-center justify-between gap-3 py-1.5">
              <span className="text-muted-foreground">
                #{s.seq} · {new Date(s.at).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                {s.documentNumber ? ` · ${s.documentNumber}` : ""}
              </span>
              {s.recordUrl
                ? <a href={s.recordUrl} target="_blank" rel="noopener noreferrer" className="text-primary inline-flex items-center gap-1"><ExternalLink className="w-3 h-3" />{s.internalId ?? "ver"}</a>
                : <span className="font-mono text-muted-foreground">{s.internalId ?? "—"}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
