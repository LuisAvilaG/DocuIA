"use client";

import { useRef, useState } from "react";
import { CheckCircle2, FileUp, Loader2, X } from "lucide-react";
import { btn, Notice } from "@/components/kit";

export function DeliveryForm({ token, maxFiles, maxMb, maxTotalMb }: { token: string; maxFiles: number; maxMb: number; maxTotalMb: number }) {
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<number | null>(null);

  function add(list: FileList | null) {
    if (!list) return;
    setError(null);
    const next = [...files];
    for (const f of Array.from(list)) {
      if (f.size > maxMb * 1024 * 1024) { setError(`«${f.name}» pesa más de ${maxMb} MB.`); continue; }
      if (!next.some((x) => x.name === f.name && x.size === f.size)) next.push(f);
    }
    if (next.length > maxFiles) setError(`Puedes subir hasta ${maxFiles} archivos.`);
    // La entrega viaja en una sola petición: lo que no cabe se deja fuera aquí,
    // no como un rechazo del servidor sin salida.
    const kept: File[] = [];
    let bytes = 0;
    for (const f of next.slice(0, maxFiles)) {
      if (bytes + f.size > maxTotalMb * 1024 * 1024) { setError(`La entrega no puede pesar más de ${maxTotalMb} MB en total. «${f.name}» no se agregó.`); continue; }
      bytes += f.size; kept.push(f);
    }
    setFiles(kept);
  }

  async function submit() {
    setBusy(true); setError(null);
    const fd = new FormData();
    for (const f of files) fd.append("files", f);
    if (note.trim()) fd.append("note", note.trim());
    try {
      const res = await fetch(`/api/public/entregar/${encodeURIComponent(token)}`, { method: "POST", body: fd });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d.error ?? "No se pudo enviar. Intenta de nuevo."); return; }
      setSent(d.files ?? files.length);
    } catch { setError("Sin conexión. Intenta de nuevo."); } finally { setBusy(false); }
  }

  if (sent !== null) {
    return (
      <section className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card p-8 text-center">
        <CheckCircle2 className="size-8 text-tone-ok" />
        <h2 className="text-lg font-semibold">Recibimos {sent} documento{sent === 1 ? "" : "s"}</h2>
        <p className="text-[14px] text-muted-foreground">Ya puedes cerrar esta página. Te contactarán si falta algo.</p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5">
      <button type="button" onClick={() => input.current?.click()}
        onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); add(e.dataTransfer.files); }}
        className="flex flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border px-4 py-8 text-center hover:border-primary">
        <FileUp className="size-6 text-muted-foreground" />
        <span className="text-[14px] font-semibold">Elige o arrastra los archivos</span>
        <span className="text-xs text-muted-foreground">PDF, PNG o JPG · hasta {maxFiles} archivos de {maxMb} MB, {maxTotalMb} MB en total</span>
      </button>
      <input ref={input} type="file" multiple accept="application/pdf,image/png,image/jpeg" className="sr-only" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
      {files.length > 0 && (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {files.map((f) => (
            <li key={`${f.name}-${f.size}`} className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]">
              <span className="min-w-0 truncate">{f.name}</span>
              <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">{(f.size / 1024 / 1024).toLocaleString("es-MX", { maximumFractionDigits: 1 })} MB
                <button type="button" aria-label={`Quitar ${f.name}`} onClick={() => setFiles(files.filter((x) => x !== f))} className="rounded p-1 hover:bg-secondary"><X className="size-3.5" /></button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-semibold">Nota (opcional)</span>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} className="rounded-md border border-border bg-background px-3 py-2 text-[14px] outline-none focus:border-primary" />
      </label>
      {error && <Notice tone="err" title={error} />}
      <button type="button" onClick={() => void submit()} disabled={busy || files.length === 0} className={btn("primary", "md", "self-start")}>
        {busy && <Loader2 className="animate-spin" />} Enviar {files.length ? `${files.length} archivo${files.length === 1 ? "" : "s"}` : "documentos"}
      </button>
    </section>
  );
}
