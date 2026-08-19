"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BrainCircuit, CheckCircle2, Loader2, Trash2 } from "lucide-react";

interface Learning {
  id: number;
  documentType: string;
  fieldKey: string;
  originalValue: string | null;
  correctedValue: string;
  citation: string | null;
  createdAt: string;
}

export function ContractLearningClient({ learnings }: { learnings: Learning[] }) {
  const router = useRouter();
  const [removing, setRemoving] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function removeLearning(id: number) {
    setRemoving(id); setError(null);
    try {
      const response = await fetch(`/api/v1/contracts/learnings/${id}`, { method: "DELETE" });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "No se pudo retirar el aprendizaje.");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo retirar el aprendizaje.");
    } finally {
      setRemoving(null);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto space-y-5">
        <header className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary"><BrainCircuit className="h-4.5 w-4.5" /></span>
          <div><h1 className="text-base font-semibold text-foreground">Calidad de extracción</h1><p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">Los ejemplos aprobados ayudan a DocuIA a reconocer cómo este cliente expresa sus campos. Se crean al corregir un dato dentro de un caso.</p></div>
        </header>

        {error && <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
        {learnings.length === 0 ? (
          <div className="rounded-xl border border-border bg-card px-6 py-10 text-center"><CheckCircle2 className="mx-auto h-5 w-5 text-success" /><p className="mt-3 text-sm font-medium text-foreground">Aún no hay aprendizajes aprobados</p><p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">Revisa un caso, corrige un dato y activa “Aplicar a futuros documentos” para crear el primer ejemplo.</p></div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="grid grid-cols-[minmax(150px,0.7fr)_minmax(130px,0.6fr)_minmax(0,1fr)_minmax(0,1fr)_90px] gap-3 border-b border-border bg-secondary/35 px-5 py-2 text-[10px] font-medium uppercase tracking-[0.06em] text-muted-foreground"><span>Documento</span><span>Campo</span><span>Lectura original</span><span>Corrección aprobada</span><span /></div>
            <div className="divide-y divide-border">
              {learnings.map((learning) => <div key={learning.id} className="grid grid-cols-[minmax(150px,0.7fr)_minmax(130px,0.6fr)_minmax(0,1fr)_minmax(0,1fr)_90px] items-start gap-3 px-5 py-3 text-xs">
                <div><p className="font-medium text-foreground">{learning.documentType}</p><p className="mt-0.5 text-[10px] tabular-nums text-muted-foreground">{new Date(learning.createdAt).toLocaleDateString("es-MX")}</p></div>
                <code className="break-all rounded bg-secondary px-1.5 py-0.5 text-[10px] text-foreground">{learning.fieldKey}</code>
                <p className="break-words text-muted-foreground">{learning.originalValue || "Sin valor"}</p>
                <div><p className="break-words font-medium text-foreground">{learning.correctedValue}</p>{learning.citation && <p className="mt-1 line-clamp-2 text-[10px] text-muted-foreground">Evidencia: {learning.citation}</p>}</div>
                <button onClick={() => removeLearning(learning.id)} disabled={removing === learning.id} className="inline-flex items-center justify-center gap-1 rounded-md border border-border px-2 py-1.5 text-[10px] font-medium text-muted-foreground hover:bg-secondary hover:text-destructive disabled:opacity-50">{removing === learning.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />} Retirar</button>
              </div>)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
