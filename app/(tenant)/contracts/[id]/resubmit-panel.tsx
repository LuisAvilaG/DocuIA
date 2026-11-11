"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Copy, Link2, Loader2, Upload } from "lucide-react";
import { btn } from "@/components/kit";
import { uploadContractFile } from "@/lib/contracts/upload-client";

interface Request { to: string; reason: string; documents: string[]; message?: string; at: string; byEmail?: string | null; emailSent?: boolean; linkExpiresAt?: string | null }
type Item = { key: string; name: string; status: "uploading" | "done" | "error"; progress: number; uploadId?: string; error?: string; replaces: string };

const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.tiff,.txt,.xml";

/** Caso esperando documentos: qué se pidió y la carga de las versiones corregidas. */
export function ResubmitPanel({ caseId, request, documents, canWrite }: {
  caseId: string;
  request: Request | null;
  documents: { id: string; label: string }[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [link, setLink] = useState<{ url: string; expiresAt: string; copied: boolean } | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);

  // Enlace nuevo para que el contratista suba los documentos sin cuenta (anula el anterior).
  async function newLink() {
    setLinkBusy(true); setError("");
    try {
      const res = await fetch(`/api/v1/contracts/cases/${caseId}/upload-link`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "No se pudo crear el enlace."); return; }
      let copied = false;
      try { await navigator.clipboard.writeText(data.url); copied = true; } catch { /* se muestra para copiar a mano */ }
      setLink({ url: data.url, expiresAt: data.expiresAt, copied });
    } catch { setError("No se pudo conectar con el servidor."); } finally { setLinkBusy(false); }
  }

  function add(files: File[]) {
    const start = items.length;
    const next = files.slice(0, Math.max(0, 10 - start)).map((f, i) => ({ key: `${Date.now()}-${start + i}`, name: f.name, status: "uploading" as const, progress: 0, replaces: "" }));
    setItems((cur) => [...cur, ...next]);
    next.forEach((it, i) => {
      const file = files[i];
      const patch = (p: Partial<Item>) => setItems((cur) => cur.map((x) => (x.key === it.key ? { ...x, ...p } : x)));
      uploadContractFile(file, (progress) => patch({ progress }))
        .then((uploadId) => patch({ status: "done", uploadId }))
        .catch((e: unknown) => patch({ status: "error", error: e instanceof Error ? e.message : "No se pudo subir" }));
    });
  }

  async function submit() {
    setBusy(true); setError("");
    try {
      const res = await fetch(`/api/v1/contracts/cases/${caseId}/resubmit`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: items.filter((i) => i.status === "done").map((i) => ({ uploadId: i.uploadId, replaces: i.replaces || null })) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "No se pudieron agregar los documentos."); return; }
      router.refresh();
    } catch {
      setError("No se pudo conectar con el servidor.");
    } finally {
      setBusy(false);
    }
  }

  const ready = items.some((i) => i.status === "done") && !items.some((i) => i.status === "uploading");

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-[#C9DAF0] bg-tone-blue-bg px-5 py-4">
      <div>
        <b className="block text-base font-semibold text-tone-blue">Esperando documentos corregidos</b>
        {request ? (
          <p className="mt-1 text-[13.5px]">
            Se pidieron a <b className="font-semibold">{request.to}</b> el {new Date(request.at).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}{request.byEmail ? ` por ${request.byEmail}` : ""}.
            {request.emailSent === false && <span className="text-tone-warn"> El correo no se pudo enviar; avísale por otro medio.</span>}
          </p>
        ) : <p className="mt-1 text-[13.5px]">El caso espera una nueva versión de sus documentos.</p>}
        {request && (
          <dl className="mt-2 grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px]">
            <dt className="text-muted-foreground">Motivo</dt><dd>{request.reason}</dd>
            {request.documents.length > 0 && <><dt className="text-muted-foreground">Documentos</dt><dd>{request.documents.join(", ")}</dd></>}
            {request.linkExpiresAt && <><dt className="text-muted-foreground">Enlace</dt><dd>El contratista puede subirlos con el enlace del correo hasta el {new Date(request.linkExpiresAt).toLocaleDateString("es-MX", { day: "numeric", month: "long" })}.</dd></>}
          </dl>
        )}
        {canWrite && (
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void newLink()} disabled={linkBusy} className={btn("secondary", "sm")}>
              {linkBusy ? <Loader2 className="animate-spin" /> : <Link2 />} Copiar enlace nuevo para el contratista
            </button>
            {link && (
              <span className="flex min-w-0 items-center gap-1.5 text-xs">
                {link.copied ? <CheckCircle2 className="size-3.5 shrink-0 text-tone-ok" /> : <Copy className="size-3.5 shrink-0" />}
                <span className="min-w-0 truncate">{link.copied ? "Copiado. " : ""}<code className="select-all">{link.url}</code></span>
              </span>
            )}
          </div>
        )}
      </div>

      {canWrite && (
        <div className="flex flex-col gap-2.5 border-t border-[#C9DAF0] pt-3.5">
          <span className="text-[13px] font-semibold">¿Ya llegaron? Súbelos aquí y el caso se vuelve a analizar.</span>
          {items.map((it) => (
            <div key={it.key} className="grid items-center gap-2 rounded-lg bg-white px-3 py-2 text-[13px] sm:grid-cols-[minmax(0,1fr)_220px]">
              <span className="min-w-0 truncate">
                <b className="font-semibold">{it.name}</b>
                <span className="ml-2 text-xs text-muted-foreground">{it.status === "uploading" ? `Subiendo ${Math.round(it.progress * 100)} %` : it.status === "error" ? it.error : "Listo"}</span>
              </span>
              <select aria-label={`Qué reemplaza ${it.name}`} value={it.replaces} onChange={(e) => setItems((cur) => cur.map((x) => (x.key === it.key ? { ...x, replaces: e.target.value } : x)))}
                className="min-h-9 rounded-lg border border-[#D6D2C8] bg-white px-2 text-[13px]">
                <option value="">Documento nuevo</option>
                {documents.map((d) => <option key={d.id} value={d.id}>Reemplaza a: {d.label}</option>)}
              </select>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={btn("secondary", "sm")} onClick={() => input.current?.click()} disabled={busy || items.length >= 10}><Upload />Elegir archivos</button>
            <button type="button" className={btn("primary", "sm")} onClick={submit} disabled={!ready || busy}>{busy && <Loader2 className="animate-spin" />}Agregar y volver a analizar</button>
            {error && <span role="alert" className="text-[13px] text-tone-err">{error}</span>}
          </div>
          <input ref={input} type="file" multiple accept={ACCEPT} className="sr-only" tabIndex={-1} onChange={(e) => { add(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
        </div>
      )}
    </section>
  );
}
