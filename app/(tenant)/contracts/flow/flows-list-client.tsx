"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Plus, Trash2, Copy, Pencil, Workflow, X, Power } from "lucide-react";

interface FlowRow { id: string; name: string; version: number; isActive: boolean; updatedAt: string }

export function ContractFlowsListClient() {
  const router = useRouter();
  const [flows, setFlows] = useState<FlowRow[]>([]);
  const [maxFlows, setMaxFlows] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<FlowRow | null>(null);

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
    setBusy(true); setErr(null);
    const res = await fetch(`/api/v1/contracts/flow/${f.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); setErr(d.error ?? "No se pudo eliminar"); return; }
    setPendingDelete(null);
    await load();
  }

  async function toggleActivation(f: FlowRow) {
    setBusy(true); setErr(null);
    const res = await fetch(`/api/v1/contracts/flow/${f.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !f.isActive }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setErr(data.error ?? "No se pudo actualizar el estado del flujo"); return; }
    await load();
  }

  if (loading) return <div className="flex-1 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-5">
        <div className="flex items-end justify-between gap-3">
          <div>
            <Link href="/cases" className="text-[11px] text-muted-foreground hover:text-foreground">← Casos</Link>
            <h1 className="text-base font-semibold tracking-[-0.01em] text-foreground mt-1">Flujos de contratos</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Activa únicamente los flujos listos para usarse. Los borradores no aparecen al crear un caso.</p>
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
                  <button
                    type="button"
                    onClick={() => toggleActivation(f)}
                    disabled={busy}
                    aria-pressed={f.isActive}
                    title={f.isActive ? "Desactivar flujo" : "Activar flujo"}
                    className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors disabled:opacity-50 ${f.isActive ? "bg-success/10 text-success hover:bg-success/20" : "bg-secondary text-muted-foreground hover:bg-secondary/70 hover:text-foreground"}`}
                  >
                    <Power className="h-3 w-3" /> {f.isActive ? "Activo" : "Borrador"}
                  </button>
                  <Link href={`/contracts/flow/${f.id}`} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-[11px] font-medium text-foreground hover:bg-secondary transition-colors"><Pencil className="w-3 h-3" /> Editar</Link>
                  <button onClick={() => duplicate(f)} disabled={busy || atLimit} title={atLimit ? `Máximo ${maxFlows} flujos` : "Duplicar"} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-40 transition-colors"><Copy className="w-3.5 h-3.5" /></button>
                  <button onClick={() => { setErr(null); setPendingDelete(f); }} disabled={busy} title="Eliminar" aria-label={`Eliminar ${f.name}`} className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-secondary transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {pendingDelete && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onMouseDown={() => !busy && setPendingDelete(null)}>
          <div role="dialog" aria-modal="true" aria-labelledby="delete-flow-title" className="w-full max-w-md rounded-xl border border-border bg-card shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <p id="delete-flow-title" className="text-sm font-semibold text-foreground">Eliminar flujo</p>
              <button onClick={() => setPendingDelete(null)} disabled={busy} aria-label="Cerrar" className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-secondary disabled:opacity-50"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-2 p-4">
              <p className="text-xs text-foreground">¿Eliminar <strong>{pendingDelete.name}</strong>?</p>
              <p className="text-xs leading-relaxed text-muted-foreground">No se puede deshacer. Los casos existentes conservan su historial y el flujo aplicado, pero no podrás usar este flujo en casos nuevos.</p>
              {err && <p className="text-xs text-destructive" role="alert">{err}</p>}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
              <button onClick={() => setPendingDelete(null)} disabled={busy} className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary disabled:opacity-50">Cancelar</button>
              <button onClick={() => remove(pendingDelete)} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-destructive px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50">
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Eliminar flujo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
