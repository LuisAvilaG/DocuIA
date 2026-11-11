"use client";

// Escribir el control en palabras: la IA llena el formulario y se puede deshacer.
import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";

type Applied = { name: string; severity: string; rule: Record<string, unknown> };

export function RuleFromText({ docTypes, fieldsByType, current, onApply }: {
  docTypes: Array<{ key: string; name: string }>;
  fieldsByType: Record<string, string[]>;
  current: Applied;
  onApply: (next: Applied) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ explanation: string; previous: Applied } | null>(null);

  async function convert() {
    setBusy(true); setError(null); setDone(null);
    try {
      const res = await fetch("/api/v1/contracts/flow/rule-from-text", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, docTypes, fieldsByType }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d.error ?? "No se pudo convertir."); return; }
      setDone({ explanation: d.explanation || "Control configurado.", previous: current });
      onApply({ name: d.name, severity: d.severity, rule: d.rule });
    } catch { setError("Sin conexión."); } finally { setBusy(false); }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-background p-3">
      <label className="flex flex-col gap-1.5">
        <span className="flex items-center gap-1.5 text-[12.5px] font-semibold"><Sparkles className="size-3.5 text-primary" />Escríbelo en tus palabras</span>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={2000}
          placeholder="Ej. El valor asegurado de la póliza no puede ser menor al 10 % del valor del contrato; si pasa, bloquea."
          className="rounded-md border border-border bg-card px-2.5 py-2 text-[12.5px] outline-none focus:border-primary" />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void convert()} disabled={busy || text.trim().length < 8}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-[12px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
          {busy && <Loader2 className="size-3.5 animate-spin" />} Llenar el control
        </button>
        <span className="text-[11px] text-muted-foreground">Revisa el resultado abajo antes de guardar.</span>
      </div>
      {error && <p role="alert" className="text-[12px] text-tone-err">{error}</p>}
      {done && (
        <p className="text-[12px]">
          <b className="font-semibold">Así lo entendí:</b> {done.explanation}{" "}
          <button type="button" onClick={() => { onApply(done.previous); setDone(null); }} className="font-semibold text-link hover:underline">Deshacer</button>
        </p>
      )}
    </div>
  );
}
