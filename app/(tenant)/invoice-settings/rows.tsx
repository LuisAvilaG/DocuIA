"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { btn, StatusPill } from "@/components/kit";
import { cn } from "@/lib/utils";

export interface SettingField {
  key: string; label: string; type: "boolean" | "number" | "string" | "select" | "date";
  min?: number; max?: number; options?: string[]; optionLabels?: Record<string, string>; hint?: string;
}

export interface SettingRow {
  id: string;
  name: string;
  description: string;
  granted: boolean;
  enabled: boolean;
  /** Cómo se enciende: el cliente con su interruptor, el modo prueba (endpoint propio) o solo DocuIA. */
  control: "toggle" | "dry_run" | "none";
  tenantOff: boolean;
  fields: SettingField[];
  values: Record<string, unknown>;
  summary: string | null;
  technical: boolean;
  link: { href: string; label: string } | null;
}

const input = "min-h-[34px] w-full rounded-lg border border-[#D6D2C8] bg-white px-2.5 text-[13px] outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";

async function patch(url: string, body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  try {
    const res = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { ok: res.ok, data: await res.json().catch(() => ({})) };
  } catch {
    return { ok: false, data: { error: "No se pudo conectar con el servidor." } };
  }
}

export function SettingRows({ rows }: { rows: SettingRow[] }) {
  return <>{rows.map((r) => <Row key={r.id} row={r} />)}</>;
}

function Row({ row }: { row: SettingRow }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(row.enabled);
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState(row.values);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function toggle(next: boolean) {
    setBusy(true); setError(""); setEnabled(next);
    const r = row.control === "dry_run"
      ? await patch("/api/v1/features/dry-run", { isEnabled: next })
      : await patch(`/api/v1/settings/features/${row.id}`, { enabled: next });
    setBusy(false);
    if (!r.ok) { setEnabled(!next); setError(String(r.data.error ?? "No se pudo guardar.")); return; }
    router.refresh();
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(""); setSaved(false);
    const r = await patch(`/api/v1/settings/features/${row.id}`, { config: values });
    setBusy(false);
    if (!r.ok) { setError(String(r.data.error ?? "No se pudo guardar.")); return; }
    setSaved(true);
    setOpen(false);
    router.refresh();
  }

  const canAdjust = row.granted && row.fields.length > 0;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-line-soft px-4.5 py-3.5 last:border-0">
      <span className={cn("min-w-0", !row.granted && "opacity-70")}>
        <b className="block text-sm font-semibold">{row.name}</b>
        <span className="mt-0.5 block text-[13px] text-foreground/75">{row.description}</span>
        {row.summary && <span className="mt-1 block text-[12.5px] text-muted-foreground first-letter:uppercase">{row.summary}</span>}
        {saved && !error && <span role="status" className="mt-1 block text-[12.5px] text-tone-ok">Guardado.</span>}
        {error && <span role="alert" className="mt-1 block text-[12.5px] text-tone-err">{error}</span>}
      </span>
      <span className="flex items-center gap-2.5">
        {row.link && row.granted && <Link href={row.link.href} className={btn("secondary", "sm")}>{row.link.label}</Link>}
        {canAdjust && <button type="button" aria-expanded={open} onClick={() => { setOpen((o) => !o); setSaved(false); }} className={btn("secondary", "sm")}>{open ? "Cerrar" : "Ajustar"}</button>}
        {!row.granted ? (
          <StatusPill tone="mute">No contratada</StatusPill>
        ) : row.control !== "none" ? (
          <>
            {busy && !open && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />}
            <Switch checked={enabled} disabled={busy} onCheckedChange={(v) => toggle(Boolean(v))} aria-label={row.name} />
          </>
        ) : (
          <StatusPill tone={enabled ? "ok" : "mute"}>{enabled ? "Activa" : "Apagada"}{canAdjust ? "" : " · lo ajusta DocuIA"}</StatusPill>
        )}
      </span>

      {open && canAdjust && (
        <form onSubmit={save} className="col-span-2 grid gap-3 rounded-[10px] bg-background px-4 py-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {row.fields.map((f) => {
            const v = values[f.key];
            const set = (x: unknown) => setValues((cur) => ({ ...cur, [f.key]: x }));
            if (f.type === "boolean") {
              return (
                <label key={f.key} className="flex items-center gap-2 text-[13px]">
                  <input type="checkbox" checked={v === true} onChange={(e) => set(e.target.checked)} className="size-[15px] accent-primary" />{f.label}
                </label>
              );
            }
            return (
              <label key={f.key} className="flex flex-col gap-1.5 text-[12.5px] font-semibold text-foreground/90">
                {f.label}
                {f.type === "select" ? (
                  <select value={String(v ?? f.options?.[0] ?? "")} onChange={(e) => set(e.target.value)} className={input}>
                    {(f.options ?? []).map((o) => <option key={o} value={o}>{f.optionLabels?.[o] ?? o}</option>)}
                  </select>
                ) : f.type === "number" ? (
                  <input type="number" min={f.min} max={f.max} step="any" value={v === null || v === undefined ? "" : String(v)} onChange={(e) => set(e.target.value === "" ? null : Number(e.target.value))} className={cn(input, "tabular-nums")} />
                ) : (
                  <input value={String(v ?? "")} onChange={(e) => set(e.target.value)} className={input} />
                )}
                {f.hint && <span className="text-xs font-normal text-muted-foreground">{f.hint}</span>}
              </label>
            );
          })}
          <div className="flex items-center justify-end gap-2 sm:col-span-2 lg:col-span-3">
            <button type="button" onClick={() => { setOpen(false); setValues(row.values); setError(""); }} disabled={busy} className={btn("text", "sm")}>Cancelar</button>
            <button type="submit" disabled={busy} className={btn("primary", "sm")}>{busy && <Loader2 className="animate-spin" />}Guardar</button>
          </div>
        </form>
      )}
    </div>
  );
}

/** Umbral de confianza de la organización: con qué confianza de lectura se envía sola la factura. */
export function ThresholdRow({ initialPct, autoSend }: {
  initialPct: number;
  /** Whether invoices are sent on their own at all; DocuIA can take the switch away. */
  autoSend: { granted: boolean; enabled: boolean };
}) {
  const router = useRouter();
  const [pct, setPct] = useState(initialPct);
  const [saved, setSaved] = useState(initialPct);
  const [on, setOn] = useState(autoSend.enabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function toggle(next: boolean) {
    setBusy(true); setError(""); setOn(next);
    const r = await patch("/api/v1/settings/features/auto_send", { enabled: next });
    setBusy(false);
    if (!r.ok) { setOn(!next); setError(String(r.data.error ?? "No se pudo guardar.")); return; }
    router.refresh();
  }

  async function save() {
    setBusy(true); setError("");
    const r = await patch("/api/v1/settings", { autoProcessThreshold: pct / 100 });
    setBusy(false);
    if (!r.ok) { setError(String(r.data.error ?? "No se pudo guardar.")); return; }
    setSaved(pct);
    router.refresh();
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-line-soft px-4.5 py-3.5">
      <span className="min-w-0">
        <b className="block text-sm font-semibold">Envío automático</b>
        <span className="mt-0.5 block text-[13px] text-foreground/75">
          {on
            ? "Las facturas leídas con esta confianza o más se envían solas al ERP; las demás pasan a revisión."
            : "Apagado: ninguna factura se envía sola. Todas pasan a revisión y una persona las envía al ERP."}
        </span>
        {error && <span role="alert" className="mt-1 block text-[12.5px] text-tone-err">{error}</span>}
      </span>
      <span className="flex items-center gap-2.5">
        {on && (
          <>
            <label className="flex items-center gap-2 text-[13px]">
              <span className="sr-only">Confianza mínima</span>
              <input type="range" min={50} max={100} step={5} value={pct} onChange={(e) => setPct(Number(e.target.value))} className="w-36 accent-primary" />
              <b className="w-11 text-right tabular-nums">{pct} %</b>
            </label>
            <button type="button" onClick={save} disabled={busy || pct === saved} className={btn("primary", "sm")}>{busy && pct !== saved && <Loader2 className="animate-spin" />}Guardar</button>
          </>
        )}
        {autoSend.granted
          ? <Switch checked={on} disabled={busy} onCheckedChange={(v) => toggle(Boolean(v))} aria-label="Envío automático" />
          : <StatusPill tone="mute">Apagado · lo ajusta DocuIA</StatusPill>}
      </span>
    </div>
  );
}

/** Ubicación que lleva la factura de una subsidiaria cuando nadie elige otra. */
export function SubsidiaryLocationRow({ subsidiaryId, initial, locations }: { subsidiaryId: string; initial: string; locations: { id: string; name: string }[] }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function choose(next: string) {
    const before = value;
    setBusy(true); setError(""); setSaved(false); setValue(next);
    const r = await patch(`/api/v1/settings/subsidiaries/${subsidiaryId}`, { defaultLocationId: next || null });
    setBusy(false);
    if (!r.ok) { setValue(before); setError(String(r.data.error ?? "No se pudo guardar.")); return; }
    setSaved(true);
    router.refresh();
  }

  // A default that is no longer in the ERP's list is not sent; it shows so it can be changed.
  const gone = Boolean(value) && !locations.some((l) => l.id === value);
  return (
    <label className="mt-3 grid items-center gap-x-4 gap-y-1 text-[13px] sm:grid-cols-[minmax(0,1fr)_260px]">
      <span className="min-w-0">
        <b className="block font-semibold">Ubicación predeterminada</b>
        <span className="block text-[12.5px] text-muted-foreground">
          La que lleva la factura cuando se envía sola al ERP, y la que aparece elegida al revisarla. Si tu ERP exige ubicación, sin ella el envío automático se rechaza.
        </span>
        {gone && <span className="mt-1 block text-[12.5px] text-tone-warn">La ubicación guardada ya no está entre las del ERP: elige otra.</span>}
        {saved && !error && <span role="status" className="mt-1 block text-[12.5px] text-tone-ok">Guardado.</span>}
        {error && <span role="alert" className="mt-1 block text-[12.5px] text-tone-err">{error}</span>}
      </span>
      {locations.length === 0 ? (
        <span className="text-[12.5px] text-muted-foreground">Sin ubicaciones del ERP. <Link href="/catalogs" className="font-semibold text-link hover:underline">Sincroniza los catálogos</Link>.</span>
      ) : (
        <select value={gone ? "" : value} disabled={busy} onChange={(e) => choose(e.target.value)} className={input}>
          <option value="">Sin ubicación</option>
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      )}
    </label>
  );
}
