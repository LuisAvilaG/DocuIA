"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";

type OutputFormat = "word" | "pdf";

function filenameFromResponse(response: Response, fallback: string) {
  const match = response.headers.get("content-disposition")?.match(/filename="?([^";]+)"?/i);
  return match?.[1] || fallback;
}

export function OutputDownloads({ caseId, hasWord }: { caseId: string; hasWord: boolean }) {
  const [busy, setBusy] = useState<OutputFormat | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function download(format: OutputFormat) {
    setBusy(format); setError(null);
    try {
      const response = await fetch(`/api/v1/contracts/cases/${caseId}/output?format=${format}`);
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "No fue posible preparar la descarga.");
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filenameFromResponse(response, format === "pdf" ? "documento.pdf" : "documento.docx");
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No fue posible preparar la descarga.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1.5 shrink-0">
      {hasWord && <button type="button" onClick={() => void download("word")} disabled={busy !== null}
        className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline disabled:cursor-wait disabled:opacity-60">
        {busy === "word" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} {busy === "word" ? "Descargando Word…" : "Word editable"}
      </button>}
      <button type="button" onClick={() => void download("pdf")} disabled={busy !== null}
        className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline disabled:cursor-wait disabled:opacity-60">
        {busy === "pdf" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} {busy === "pdf" ? "Preparando PDF…" : hasWord ? "PDF para compartir" : "Descargar PDF"}
      </button>
      {error && <p role="alert" className="basis-full text-right text-[10px] text-destructive">{error}</p>}
    </div>
  );
}
