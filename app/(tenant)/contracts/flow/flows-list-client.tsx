"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Plus, Trash2, Copy, Pencil, Workflow } from "lucide-react";

interface FlowRow { id: string; name: string; version: number; updatedAt: string }

export function ContractFlowsListClient() {
  const router = useRouter();
  const [flows, setFlows] = useState<FlowRow[]>([]);
  const [maxFlows, setMaxFlows] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    const d = await fetch("/api/v1/contracts/flow").then((r) => r.json());
    setFlows(d.flows ?? []); setMaxFlows(d.maxFlows ?? 1);
  }
  useEffect(() => {
    (async () => { try { await load(); } finally { setLoading(false); } })();
  }, []);

  const atLimit = flows.length >= maxFlows;

  async function create() {
    setBusy(true); setErr(null);
    const res = await fetch("/api/v1/contracts/flow", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Nuevo flujo", graph: { nodes: [], edges: [] } }) });
    const d = await res.json(); setBusy(false);
    if (!res.ok) { setErr(d.error ?? "No se pudo crear"); return; }
    router.push(`/contracts/flow/${d.id}`);
  }

  async function duplicate(f: FlowRow) {
    setBusy(true); setErr(null);
    const src = await fetch(`/api/v1/contracts/flow/${f.id}`).then((r) => r.json());
    const res = await fetch("/api/v1/contracts/flow", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: `${f.name} (copia)`, graph: src.flow?.graph ?? { nodes: [], edges: [] } }) });
    const d = await res.json(); setBusy(false);
    if (!res.ok) { setErr(d.error ?? "No se pudo duplicar"); return; }
    await load();
  }

  async function remove(f: FlowRow) {
    if (!window.confirm(`¿Eliminar el flujo "${f.name}"? Esta acción no se puede deshacer.`)) return;
    setBusy(true); setErr(null);
    const res = await fetch(`/api/v1/contracts/flow/${f.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); setErr(d.error ?? "No se pudo eliminar"); return; }
    await load();
  }

  if (loading) return <div className="flex-1 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-5">
        <div className="flex items-end justify-between gap-3">
          <div>
            <Link href="/contracts" className="text-[11px] text-muted-foreground hover:text-foreground">← Casos</Link>
            <h1 className="text-base font-semibold tracking-[-0.01em] text-foreground mt-1">Flujos de contratos</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Cada flujo define cómo se procesa un caso: qué documentos entran, qué se extrae, qué se valida y qué se genera.</p>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <button onClick={create} disabled={busy || atLimit} title={atLimit ? `Máximo ${maxFlows} flujos` : "Crear un flujo"}
              className="inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-4 py-2 text-xs font-medium shadow-[0_1px_3px_oklch(0.48_0.15_182_/_0.3)] hover:bg-primary/90 disabled:opacity-50 transition-colors">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Nuevo flujo
            </button>
            <span className="text-[10px] text-muted-foreground tabular-nums">{flows.length} / {maxFlows} flujos</span>
          </div>
        </div>

        {err && <p className="text-xs text-destructive">{err}</p>}

        {flows.length === 0 ? (
          <div className="bg-card border border-border rounded-xl p-10 text-center">
            <div className="w-11 h-11 rounded-lg bg-primary/10 text-primary flex items-center justify-center mx-auto"><Workflow className="w-5 h-5" /></div>
            <p className="text-sm font-medium text-foreground mt-3">Aún no hay flujos</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">Crea tu primer flujo para definir cómo la IA procesa los casos de este cliente.</p>
            <button onClick={create} disabled={busy} className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-4 py-2 text-xs font-medium mt-4 disabled:opacity-50"><Plus className="w-3.5 h-3.5" /> Crear flujo</button>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-xl overflow-hidden divide-y divide-border">
            {flows.map((f) => (
              <div key={f.id} className="flex items-center gap-3 px-5 py-3.5 hover:bg-secondary/40 transition-colors">
                <span className="w-8 h-8 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0"><Workflow className="w-4 h-4" /></span>
                <Link href={`/contracts/flow/${f.id}`} className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate hover:text-primary transition-colors">{f.name}</p>
                  <p className="text-[11px] text-muted-foreground tabular-nums">v{f.version} · actualizado {new Date(f.updatedAt).toLocaleDateString("es-MX")}</p>
                </Link>
                <div className="flex items-center gap-1 shrink-0">
                  <Link href={`/contracts/flow/${f.id}`} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-[11px] font-medium text-foreground hover:bg-secondary transition-colors"><Pencil className="w-3 h-3" /> Editar</Link>
                  <button onClick={() => duplicate(f)} disabled={busy || atLimit} title={atLimit ? `Máximo ${maxFlows} flujos` : "Duplicar"} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-40 transition-colors"><Copy className="w-3.5 h-3.5" /></button>
                  <button onClick={() => remove(f)} disabled={busy} title="Eliminar" className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-secondary transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
