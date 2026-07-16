"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Upload, Loader2, FileText, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface CaseRow { id: string; title: string | null; status: string; createdAt: string }

const STATUS_LABEL: Record<string, string> = {
  uploaded: "En cola", processing: "Procesando", review: "En revisión",
  validated: "Validado", generated: "Generado", failed: "Error",
};
const STATUS_COLOR: Record<string, string> = {
  uploaded: "text-muted-foreground", processing: "text-warning", review: "text-warning",
  validated: "text-success", generated: "text-success", failed: "text-destructive",
};

export function ContractsClient({ cases }: { cases: CaseRow[] }) {
  const router = useRouter();
  const [files, setFiles] = useState<FileList | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flows, setFlows] = useState<Array<{ id: string; name: string }>>([]);
  const [flowId, setFlowId] = useState<string>("");

  useEffect(() => {
    fetch("/api/v1/contracts/flow").then((r) => r.json()).then((d) => {
      const list = (d.flows ?? []) as Array<{ id: string; name: string }>;
      setFlows(list);
      if (list.length > 0) setFlowId(list[0].id);
    }).catch(() => {});
  }, []);

  async function submit() {
    if (!files || files.length === 0) { setError("Selecciona al menos un documento"); return; }
    setBusy(true); setError(null);
    try {
      const fd = new FormData();
      if (title) fd.append("title", title);
      if (flowId && flows.length > 1) fd.append("flowId", flowId);
      for (const f of Array.from(files)) fd.append("files", f);
      const res = await fetch("/api/v1/contracts/cases", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Error al crear el caso"); return; }
      setFiles(null); setTitle("");
      router.refresh();
    } catch {
      setError("No se pudo conectar con el servidor");
    } finally { setBusy(false); }
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-base font-semibold text-foreground">Contract Intelligence</h1>
          <p className="text-xs text-muted-foreground mt-1">Sube los documentos de un caso; la IA los clasifica y extrae los datos con trazabilidad.</p>
        </div>

        {/* Nuevo caso */}
        <div className="bg-card border border-border rounded-xl p-5 space-y-3">
          <h2 className="text-sm font-medium text-foreground">Nuevo caso</h2>
          <input
            value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="Título (opcional)"
            className="w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm"
          />
          {flows.length > 1 && (
            <label className="block space-y-1">
              <span className="text-[11px] text-muted-foreground">Flujo a aplicar</span>
              <select value={flowId} onChange={(e) => setFlowId(e.target.value)}
                className="w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm">
                {flows.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </label>
          )}
          <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.tiff,.txt,.xml"
            onChange={(e) => setFiles(e.target.files)}
            className="block w-full text-xs text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-xs file:text-foreground"
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <button onClick={submit} disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg bg-primary text-primary-foreground px-4 py-2 text-xs font-medium disabled:opacity-60">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            Analizar documentos
          </button>
        </div>

        {/* Lista de casos */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-border"><h2 className="text-sm font-medium text-foreground">Casos</h2></div>
          {cases.length === 0 ? (
            <p className="px-5 py-8 text-center text-xs text-muted-foreground">Aún no hay casos. Sube documentos arriba para empezar.</p>
          ) : (
            <div className="divide-y divide-border">
              {cases.map((c) => (
                <Link key={c.id} href={`/contracts/${c.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-accent/40 transition-colors">
                  <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{c.title || `Caso ${c.id.slice(0, 8)}`}</p>
                    <p className="text-[11px] text-muted-foreground">{new Date(c.createdAt).toLocaleString("es-MX")}</p>
                  </div>
                  <span className={cn("text-[11px] font-medium", STATUS_COLOR[c.status] ?? "text-muted-foreground")}>
                    {STATUS_LABEL[c.status] ?? c.status}
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
