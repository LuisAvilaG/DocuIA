"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, X } from "lucide-react";
import { btn, StatusPill } from "@/components/kit";
import { uploadContractFile } from "@/lib/contracts/upload-client";
import { cn } from "@/lib/utils";

interface Intake { key: string; name: string; hint: string | null; required: boolean }
interface FlowOption { id: string; name: string; documentCount: number; validationCount: number; intakes?: Intake[]; generates?: boolean }

type SlotState =
  | { status: "empty" }
  | { status: "uploading"; file: File; progress: number }
  | { status: "done"; file: File; uploadId: string }
  | { status: "error"; file: File; error: string };

const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.tiff,.txt,.xml";
const GENERIC = "__docs";

function removeUpload(id: string) {
  return fetch(`/api/v1/contracts/uploads/${id}`, { method: "DELETE" }).catch(() => undefined);
}

/** Nuevo caso: el flujo en un desplegable y una casilla por documento que pide. */
export function NewCaseDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const titleId = useId();
  const [flows, setFlows] = useState<FlowOption[] | null>(null);
  const [flowsError, setFlowsError] = useState("");
  const [flowId, setFlowId] = useState("");
  const [slots, setSlots] = useState<Record<string, SlotState>>({});
  const [extra, setExtra] = useState<SlotState[]>([]);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const created = useRef(false);
  const uploaded = useRef(new Set<string>());

  useEffect(() => {
    fetch("/api/v1/contracts/flow?activeOnly=1")
      .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error ?? "No se pudieron cargar los flujos"); return d; })
      .then((d) => { const list = (d.flows ?? []) as FlowOption[]; setFlows(list); if (list[0]) setFlowId(list[0].id); })
      .catch((e: unknown) => { setFlows([]); setFlowsError(e instanceof Error ? e.message : "No se pudieron cargar los flujos"); });
  }, []);

  // Al cerrar sin crear, los archivos subidos se liberan.
  useEffect(() => {
    const pending = uploaded.current;
    return () => { if (!created.current) for (const id of pending) void removeUpload(id); };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape" && !busy) onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const flow = flows?.find((f) => f.id === flowId) ?? null;
  const intakes = flow?.intakes ?? [];
  const generic = intakes.length === 0;

  async function upload(file: File, set: (s: SlotState) => void) {
    set({ status: "uploading", file, progress: 0 });
    try {
      const id = await uploadContractFile(file, (p) => set({ status: "uploading", file, progress: p }));
      uploaded.current.add(id);
      set({ status: "done", file, uploadId: id });
    } catch (e) {
      set({ status: "error", file, error: e instanceof Error ? e.message : "No se pudo subir" });
    }
  }

  function setSlot(key: string, file: File | null) {
    const prev = slots[key];
    if (prev?.status === "done") { uploaded.current.delete(prev.uploadId); void removeUpload(prev.uploadId); }
    if (!file) { setSlots((s) => ({ ...s, [key]: { status: "empty" } })); return; }
    void upload(file, (st) => setSlots((s) => ({ ...s, [key]: st })));
  }

  function addExtra(files: File[]) {
    const start = extra.length;
    const room = Math.max(0, 10 - start);
    files.slice(0, room).forEach((file, i) => {
      void upload(file, (st) => setExtra((cur) => { const next = [...cur]; next[start + i] = st; return next; }));
    });
  }

  function changeFlow(id: string) {
    for (const st of [...Object.values(slots), ...extra]) if (st.status === "done") { uploaded.current.delete(st.uploadId); void removeUpload(st.uploadId); }
    setSlots({}); setExtra([]); setFlowId(id);
  }

  const all: Array<[string, SlotState]> = generic ? extra.map((s, i) => [`${GENERIC}${i}`, s]) : Object.entries(slots);
  const uploading = all.some(([, s]) => s.status === "uploading");
  const missing = intakes.filter((i) => i.required && slots[i.key]?.status !== "done");
  const ready = !uploading && (generic ? extra.some((s) => s.status === "done") : missing.length === 0 && all.some(([, s]) => s.status === "done"));
  const footerHint = uploading ? "Subiendo archivos…"
    : generic ? (extra.length ? null : "Sube al menos un documento")
    : missing.length ? `Falta ${missing.map((m) => m.name.toLowerCase()).join(", ")}` : null;

  async function create() {
    setBusy(true); setError("");
    const done = all.filter((e): e is [string, Extract<SlotState, { status: "done" }>] => e[1].status === "done");
    const uploadIds = done.map(([, s]) => s.uploadId);
    const slotTypes = generic ? undefined : Object.fromEntries(done.map(([key, s]) => [s.uploadId, key]));
    try {
      const res = await fetch("/api/v1/contracts/cases", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim() || undefined, flowId: flowId || undefined, uploadIds, slotTypes }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "No se pudo crear el caso"); return; }
      created.current = true;
      router.push(`/contracts/${data.caseId}`);
    } catch {
      setError("No se pudo conectar con el servidor");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[rgba(30,32,41,0.38)] px-4 py-14" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="flex w-full max-w-[760px] flex-col rounded-[14px] bg-card shadow-[0_24px_70px_rgba(30,32,41,0.25)]">
        <div className="flex items-start justify-between gap-4 border-b border-line-soft px-6 pb-3.5 pt-5.5">
          <div>
            <h2 id={titleId} className="text-[19px] font-semibold tracking-[-0.02em]">Nuevo caso</h2>
            <p className="mt-1 text-[13.5px] text-muted-foreground">Cada documento tiene su casilla, así sabes qué falta antes de empezar.</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Cerrar" className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border text-foreground/70 hover:text-foreground"><X className="size-4" /></button>
        </div>

        <div className="flex flex-col gap-5 px-6 py-5">
          {flows === null ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Cargando flujos…</p>
          ) : (
            <>
              {flowsError && <p className="text-sm text-tone-warn">{flowsError}. Se usará la configuración predeterminada.</p>}
              {flows.length > 0 && (
                <label className="flex max-w-[420px] flex-col gap-1.5">
                  <span className="text-[13px] font-semibold text-foreground/90">Flujo</span>
                  <select value={flowId} onChange={(e) => changeFlow(e.target.value)} className="min-h-10 rounded-lg border border-[#D6D2C8] bg-white px-3 text-sm">
                    {flows.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                  {flow && <span className="text-[12.5px] text-muted-foreground">{flow.documentCount} documento{flow.documentCount === 1 ? "" : "s"} · {flow.validationCount} control{flow.validationCount === 1 ? "" : "es"}{flow.generates ? " · genera un documento" : ""}</span>}
                </label>
              )}

              <div>
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.05em] text-foreground/75">{generic ? "Documentos del caso" : "Documentos que pide este flujo"}</span>
                {generic ? (
                  <div className="flex flex-col gap-2.5">
                    {extra.map((s, i) => <Slot key={i} label={s.status === "empty" ? "" : s.file.name} required={false} state={s} onFile={() => {}} onClear={() => { if (s.status === "done") { uploaded.current.delete(s.uploadId); void removeUpload(s.uploadId); } setExtra((cur) => cur.filter((_, k) => k !== i)); }} />)}
                    {extra.length < 10 && <Drop multiple onFiles={addExtra} label="Suelta los documentos aquí" />}
                  </div>
                ) : (
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    {intakes.map((i) => (
                      <Slot key={i.key} label={i.name} hint={i.hint} required={i.required} state={slots[i.key] ?? { status: "empty" }}
                        onFile={(f) => setSlot(i.key, f)} onClear={() => setSlot(i.key, null)} />
                    ))}
                  </div>
                )}
              </div>

              <label className="flex flex-col gap-1.5">
                <span className="text-[13px] font-semibold text-foreground/90">Título <span className="font-normal text-muted-foreground">· opcional</span></span>
                <input value={title} maxLength={255} onChange={(e) => setTitle(e.target.value)} placeholder="Si lo dejas vacío, usamos el número del contrato"
                  className="min-h-10 rounded-lg border border-[#D6D2C8] bg-white px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
              </label>
              {error && <p role="alert" className="text-sm text-tone-err">{error}</p>}
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line-soft px-6 py-3.5">
          <span className="text-[12.5px] text-muted-foreground">{footerHint}</span>
          <span className="flex gap-2">
            <button type="button" onClick={onClose} disabled={busy} className={btn("secondary")}>Cancelar</button>
            <button type="button" onClick={create} disabled={!ready || busy} className={btn("primary")}>{busy && <Loader2 className="animate-spin" />}Crear y analizar</button>
          </span>
        </div>
      </div>
    </div>
  );
}

function Slot({ label, hint, required, state, onFile, onClear }: {
  label: string; hint?: string | null; required: boolean; state: SlotState; onFile: (f: File) => void; onClear: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const pill = state.status === "done" ? <StatusPill tone="ok">Listo</StatusPill>
    : state.status === "uploading" ? <StatusPill tone="info">Subiendo {Math.round(state.progress * 100)} %</StatusPill>
    : state.status === "error" ? <StatusPill tone="err">Error</StatusPill>
    : required ? <StatusPill tone="warn">Obligatorio</StatusPill> : <StatusPill tone="mute">Opcional</StatusPill>;
  const filled = state.status !== "empty";
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}
      className={cn("flex min-h-[112px] flex-col gap-2 rounded-xl px-3.5 py-3",
        filled ? "border border-[#CFE7E3] bg-white" : required ? "border-[1.5px] border-dashed border-[#E3C98C] bg-[#FFFBF2]" : "border-[1.5px] border-dashed border-[#C9C5BC] bg-background",
        over && "border-primary bg-tone-info-bg")}
    >
      <header className="flex items-start justify-between gap-2">
        <b className="text-sm font-semibold">{label}</b>{pill}
      </header>
      {filled ? (
        <>
          <span className="flex min-w-0 items-center gap-2 text-[13px]">
            <i aria-hidden className="flex h-8 w-[26px] shrink-0 items-end justify-center rounded bg-tone-err-bg pb-[3px] text-[8.5px] font-bold not-italic text-tone-err">{(state.file.name.split(".").pop() ?? "").slice(0, 4).toUpperCase()}</i>
            <span className="min-w-0 truncate font-semibold">{state.file.name}</span>
          </span>
          {state.status === "uploading" && <span className="h-1.5 overflow-hidden rounded-full bg-secondary"><span className="block h-full bg-primary" style={{ width: `${state.progress * 100}%` }} /></span>}
          {state.status === "error" && <span className="text-[12.5px] text-tone-err">{state.error}</span>}
          {state.status !== "uploading" && (
            <span className="flex gap-3 text-[13px]">
              {label && hint !== undefined && <button type="button" className="text-link hover:underline" onClick={() => input.current?.click()}>Cambiar</button>}
              <button type="button" className="text-muted-foreground hover:text-foreground" onClick={onClear}>Quitar</button>
            </span>
          )}
        </>
      ) : (
        <span className="text-[12.5px] text-muted-foreground">
          {hint && <span className="mb-1 block line-clamp-2 first-letter:uppercase">{hint}</span>}
          Suelta el archivo aquí o <button type="button" className="text-link hover:underline" onClick={() => input.current?.click()}>elígelo</button>
        </span>
      )}
      <input ref={input} type="file" accept={ACCEPT} className="sr-only" tabIndex={-1} onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
    </div>
  );
}

function Drop({ multiple, onFiles, label }: { multiple?: boolean; onFiles: (f: File[]) => void; label: string }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onFiles(Array.from(e.dataTransfer.files)); }}
      className="flex flex-col items-center gap-1 rounded-xl border-[1.5px] border-dashed border-[#C9C5BC] bg-background px-5 py-6 text-center">
      <b className="text-sm font-semibold">{label}</b>
      <span className="text-[12.5px] text-muted-foreground">PDF, imagen o texto · hasta 10 · <button type="button" className="text-link hover:underline" onClick={() => input.current?.click()}>elegir desde tu equipo</button></span>
      <input ref={input} type="file" accept={ACCEPT} multiple={multiple} className="sr-only" tabIndex={-1} onChange={(e) => { onFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
    </div>
  );
}
