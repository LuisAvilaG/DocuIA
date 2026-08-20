"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Upload, Loader2, FileText, ArrowRight, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface CaseRow { id: string; title: string | null; status: string; createdAt: string; updatedAt: string; flowName: string }
interface FlowOption {
  id: string;
  name: string;
  documentCount: number;
  validationCount: number;
}

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
  const [flows, setFlows] = useState<FlowOption[]>([]);
  const [flowId, setFlowId] = useState<string>("");
  const [flowPickerOpen, setFlowPickerOpen] = useState(false);
  const [flowsLoading, setFlowsLoading] = useState(true);
  const [flowsError, setFlowsError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/contracts/flow?activeOnly=1")
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "No se pudieron cargar los flujos");
        return data;
      })
      .then((data) => {
        const list = (data.flows ?? []) as FlowOption[];
        setFlows(list);
        if (list.length > 0) setFlowId(list[0].id);
      })
      .catch((cause: unknown) => setFlowsError(cause instanceof Error ? cause.message : "No se pudieron cargar los flujos"))
      .finally(() => setFlowsLoading(false));
  }, []);

  async function submit() {
    if (!files || files.length === 0) { setError("Selecciona al menos un documento"); return; }
    setBusy(true); setError(null);
    try {
      const fd = new FormData();
      if (title) fd.append("title", title);
      if (flowId) fd.append("flowId", flowId);
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

  const selectedFlow = flows.find((flow) => flow.id === flowId) ?? null;

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-base font-semibold text-foreground">Casos</h1>
          <p className="text-xs text-muted-foreground mt-1">Crea un caso para clasificar, extraer y validar documentos. El historial conserva toda su trazabilidad.</p>
        </div>

        {/* Nuevo caso */}
        <div className="bg-card border border-border rounded-xl p-5 space-y-3">
          <h2 className="text-sm font-medium text-foreground">Nuevo caso</h2>
          <input
            value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="Título (opcional)"
            className="w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm"
          />
          {flowsLoading && <p className="text-[11px] text-muted-foreground">Cargando flujos disponibles…</p>}
          {flowsError && <p className="text-[11px] text-warning">{flowsError}. Se usará la configuración predeterminada.</p>}
          {!flowsLoading && !flowsError && flows.length === 0 && <p className="text-[11px] text-muted-foreground">No hay flujos configurados. Se usará la configuración predeterminada.</p>}
          {flows.length > 0 && (
            <fieldset className="space-y-1.5" aria-describedby="flow-picker-help">
              <div className="flex items-baseline justify-between gap-3">
                <legend className="text-[11px] font-medium text-muted-foreground">Flujo a aplicar</legend>
                <span id="flow-picker-help" className="text-[10px] text-muted-foreground">Define la extracción y controles del caso.</span>
              </div>
              <div className="relative">
                <button type="button" aria-haspopup="listbox" aria-expanded={flowPickerOpen} onClick={() => setFlowPickerOpen((open) => !open)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2.5 text-left transition-colors hover:border-primary/45 focus:outline-none focus:ring-2 focus:ring-primary/20">
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-semibold text-foreground">{selectedFlow?.name ?? "Selecciona un flujo"}</span>
                    {selectedFlow && <span className="mt-0.5 block text-[11px] text-muted-foreground">{selectedFlow.documentCount} documento{selectedFlow.documentCount === 1 ? "" : "s"} · {selectedFlow.validationCount} control{selectedFlow.validationCount === 1 ? "" : "es"}</span>}
                  </span>
                  <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", flowPickerOpen && "rotate-180")} />
                </button>
                {flowPickerOpen && (
                  <div role="listbox" aria-label="Flujos disponibles" className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-[0_8px_28px_oklch(0.18_0.015_258_/_0.12)]">
                {flows.map((flow) => {
                  const active = flow.id === flowId;
                  return (
                    <button key={flow.id} type="button" role="option" aria-selected={active} onClick={() => { setFlowId(flow.id); setFlowPickerOpen(false); }}
                      className={cn(
                        "w-full rounded-md px-3 py-2 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20",
                        active ? "bg-primary/10 text-primary" : "text-foreground hover:bg-secondary",
                      )}>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-xs font-semibold text-foreground">{flow.name}</span>
                        {active && <span className="text-[10px] font-medium text-primary">Seleccionado</span>}
                      </div>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{flow.documentCount} documento{flow.documentCount === 1 ? "" : "s"} · {flow.validationCount} control{flow.validationCount === 1 ? "" : "es"}</p>
                    </button>
                  );
                })}
                  </div>
                )}
              </div>
            </fieldset>
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
          <div className="flex items-center justify-between gap-4 px-5 py-3 border-b border-border">
            <div>
              <h2 className="text-sm font-medium text-foreground">Casos recientes</h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground">Los últimos 5 actualizados.</p>
            </div>
            <Link href="/cases/history" className="shrink-0 text-[11px] font-medium text-primary hover:underline">Ver historial →</Link>
          </div>
          {cases.length === 0 ? (
            <p className="px-5 py-8 text-center text-xs text-muted-foreground">Aún no hay casos. Sube documentos arriba para empezar.</p>
          ) : (
            <div className="divide-y divide-border">
              {cases.map((c) => (
                <Link key={c.id} href={`/cases/${c.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-accent/40 transition-colors">
                  <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{c.title || `Caso ${c.id.slice(0, 8)}`}</p>
                    <p className="text-[11px] text-muted-foreground">Actualizado {new Date(c.updatedAt).toLocaleString("es-MX")} · Flujo: {c.flowName}</p>
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
