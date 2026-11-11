"use client";

// Versiones de flujo en el editor: publicar con nota, probar el borrador con
// casos anteriores y ver el historial.
import { useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { btn, Drawer, Notice, StatusPill } from "@/components/kit";

export interface FlowVersionRow { version: number; note: string | null; publishedAt: string; publishedBy: string | null; changes: string[] }
export interface FlowTestRow { id: string; title: string; before: Verdict; after: Verdict; newIssues: string[]; resolved: string[]; untestedAi: number; error?: string }
type Verdict = "ok" | "warn" | "block";

const VERDICT: Record<Verdict, { label: string; tone: "ok" | "warn" | "err" }> = {
  ok: { label: "Sin observaciones", tone: "ok" },
  warn: { label: "Con advertencias", tone: "warn" },
  block: { label: "Bloqueado", tone: "err" },
};

const fmt = (iso: string) => new Date(iso).toLocaleString("es", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export function PublishDrawer({ nextVersion, changes, onClose, onPublish }: {
  nextVersion: number;
  changes: string[];
  onClose: () => void;
  onPublish: (input: { note: string; reanalyze: boolean }) => Promise<string | null>;
}) {
  const [note, setNote] = useState("");
  const [reanalyze, setReanalyze] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setError(null);
    const err = await onPublish({ note: note.trim(), reanalyze });
    setBusy(false);
    if (err) setError(err);
  }

  return (
    <Drawer title={`Publicar versión ${nextVersion}`} description="Los casos nuevos usarán esta versión desde ahora." onClose={onClose} locked={busy} width={520}
      footer={<>
        <button type="button" onClick={onClose} disabled={busy} className={btn("secondary")}>Cancelar</button>
        <button type="button" onClick={() => void submit()} disabled={busy || changes.length === 0} className={btn("primary")}>
          {busy && <Loader2 className="animate-spin" />} Publicar v{nextVersion}
        </button>
      </>}>
      <div className="flex flex-col gap-5">
        <section>
          <h3 className="text-[13px] font-semibold">Qué cambia</h3>
          {changes.length === 0
            ? <p className="mt-1.5 text-[13px] text-muted-foreground">El borrador es igual a la versión publicada.</p>
            : <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[13px]">{changes.map((c) => <li key={c}>{c}</li>)}</ul>}
        </section>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold">Nota de la versión</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={2000}
            placeholder="Ej. Se pide el certificado de existencia desde enero."
            className="rounded-md border border-border bg-background px-3 py-2 text-[13px] outline-none focus:border-primary" />
        </label>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[13px] font-semibold">Casos abiertos de este flujo</legend>
          <label className="flex items-start gap-2 text-[13px]">
            <input type="radio" name="open-cases" checked={!reanalyze} onChange={() => setReanalyze(false)} className="mt-0.5" />
            <span>Siguen con la versión con que se analizaron</span>
          </label>
          <label className="flex items-start gap-2 text-[13px]">
            <input type="radio" name="open-cases" checked={reanalyze} onChange={() => setReanalyze(true)} className="mt-0.5" />
            <span>Se vuelven a analizar con la versión {nextVersion}<span className="block text-xs text-muted-foreground">Los casos en revisión vuelven a la cola. Consume análisis de IA.</span></span>
          </label>
        </fieldset>
        {error && <Notice tone="err" title={error} />}
      </div>
    </Drawer>
  );
}

export function TestDrawer({ loading, error, cases, onClose }: { loading: boolean; error: string | null; cases: FlowTestRow[]; onClose: () => void }) {
  const changed = cases.filter((c) => !c.error && (c.before !== c.after || c.newIssues.length || c.resolved.length)).length;
  const untested = cases.reduce((n, c) => Math.max(n, c.untestedAi), 0);
  return (
    <Drawer title="Probar con casos anteriores" description="El borrador se aplica a los últimos casos con los datos ya extraídos. No cambia los casos ni usa IA." onClose={onClose} width={560}>
      {loading ? (
        <p className="flex items-center gap-2 text-[13px] text-muted-foreground"><Loader2 className="size-4 animate-spin" />Probando…</p>
      ) : error ? (
        <Notice tone="err" title={error} />
      ) : cases.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">Este flujo todavía no tiene casos analizados para probar.</p>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-[13px]">{cases.length === 1
            ? (changed ? "El caso cambia con el borrador." : "El caso no cambia de resultado.")
            : changed === 0 ? `Ninguno de los ${cases.length} casos cambia de resultado.` : `${changed} de ${cases.length} casos cambian con el borrador.`}</p>
          {untested > 0 && <Notice tone="info" title="Los controles con IA nuevos no se prueban aquí">Se evalúan cuando un caso se analiza con la versión publicada.</Notice>}
          <ul className="divide-y divide-line-soft rounded-lg border border-border">
            {cases.map((c) => (
              <li key={c.id} className="flex flex-col gap-1.5 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <Link href={`/contracts/${c.id}`} className="truncate text-[13.5px] font-semibold text-link hover:underline">{c.title}</Link>
                  {!c.error && (
                    <span className="flex shrink-0 items-center gap-1.5 text-xs">
                      <StatusPill tone={VERDICT[c.before].tone}>{VERDICT[c.before].label}</StatusPill>
                      {c.before !== c.after && <>→ <StatusPill tone={VERDICT[c.after].tone}>{VERDICT[c.after].label}</StatusPill></>}
                    </span>
                  )}
                </div>
                {c.error && <p className="text-xs text-tone-err">{c.error}</p>}
                {c.newIssues.map((n) => <p key={`n${n}`} className="text-xs text-tone-err">Ahora falla: {n}</p>)}
                {c.resolved.map((n) => <p key={`r${n}`} className="text-xs text-tone-ok">Ya no falla: {n}</p>)}
                {!c.error && c.before === c.after && !c.newIssues.length && !c.resolved.length && <p className="text-xs text-muted-foreground">Sin cambios</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Drawer>
  );
}

export function HistoryDrawer({ current, history, onClose }: { current: number | null; history: FlowVersionRow[]; onClose: () => void }) {
  return (
    <Drawer title="Versiones" description="Cada caso guarda la versión con la que se analizó." onClose={onClose} width={520}>
      {history.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">Todavía no hay versiones publicadas.</p>
      ) : (
        <ol className="flex flex-col gap-4">
          {history.map((v) => (
            <li key={v.version} className="flex flex-col gap-1 border-l-2 border-border pl-4">
              <div className="flex items-center gap-2">
                <b className="text-[13.5px]">Versión {v.version}</b>
                {v.version === current && <StatusPill tone="ok">Vigente</StatusPill>}
              </div>
              <p className="text-xs text-muted-foreground">{fmt(v.publishedAt)}{v.publishedBy ? ` · ${v.publishedBy}` : ""}</p>
              {v.note && <p className="text-[13px]">{v.note}</p>}
              {v.changes.length > 0 && <ul className="list-disc pl-5 text-xs text-foreground/80">{v.changes.map((c) => <li key={c}>{c}</li>)}</ul>}
            </li>
          ))}
        </ol>
      )}
    </Drawer>
  );
}
