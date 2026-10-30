"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Loader2, X } from "lucide-react";
import { num } from "./ui";

interface Footprint {
  users: number; documents: number; cases: number; contractFiles: number; connections: number; subsidiaries: number;
  catalogItems: number; webhooks: number; apiKeys: number; featureOverrides: number; expenseReports: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  org: { id: string; name: string; slug: string; status: string; suspensionReason?: string | null };
  /** Where to go after a delete (the client no longer exists in the panel). */
  afterDelete?: string;
}

type Mode = "suspend" | "restore" | "delete";

/**
 * Two-step danger flow for a client: suspend (reversible, keeps data) or
 * delete (recoverable for 30 days, then purged). Delete asks for the slug.
 */
export function ClientLifecycleDialog({ open, onClose, org, afterDelete = "/admin/clients" }: Props) {
  const router = useRouter();
  const suspended = org.status === "suspended";
  const [mode, setMode] = useState<Mode>(suspended ? "restore" : "suspend");
  const [reason, setReason] = useState(org.suspensionReason ?? "");
  const [confirm, setConfirm] = useState("");
  const [footprint, setFootprint] = useState<Footprint | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [wasOpen, setWasOpen] = useState(open);

  // Start clean every time the dialog opens.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) { setMode(suspended ? "restore" : "suspend"); setConfirm(""); setError(""); }
  }

  useEffect(() => {
    if (!open) return;
    let active = true;
    fetch(`/api/admin/clients/${org.id}`).then((r) => (r.ok ? r.json() : null)).then((d) => { if (active) setFootprint(d?.footprint ?? null); }).catch(() => { if (active) setFootprint(null); });
    return () => { active = false; };
  }, [open, org.id]);

  if (!open) return null;

  async function run() {
    setBusy(true);
    setError("");
    try {
      let res: Response;
      if (mode === "delete") {
        res = await fetch(`/api/admin/clients/${org.id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm }) });
      } else {
        res = await fetch(`/api/admin/clients/${org.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(mode === "suspend" ? { status: "suspended", suspensionReason: reason.trim() || null } : { status: "active" }),
        });
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "No se pudo completar la acción"); return; }
      onClose();
      if (mode === "delete") router.push(afterDelete); else router.refresh();
    } catch {
      setError("No se pudo conectar al servidor");
    } finally {
      setBusy(false);
    }
  }

  const canRun = mode === "delete" ? confirm.trim() === org.slug : true;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-14 overflow-y-auto" style={{ backgroundColor: "oklch(0.18 0.015 258 / 0.45)", backdropFilter: "blur(1.5px)" }}
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="lifecycle-title" className="w-full max-w-[600px] bg-card rounded-2xl p-8 flex flex-col gap-5" style={{ boxShadow: "0 20px 60px oklch(0.18 0.015 258 / 0.18), 0 4px 16px oklch(0.18 0.015 258 / 0.08)" }}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-medium tracking-[0.06em] uppercase text-muted-foreground mb-1">{org.name} · {org.slug}</p>
            <h2 id="lifecycle-title" className="text-[22px] font-semibold tracking-[-0.02em]">¿Qué quieres hacer con esta organización?</h2>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Cerrar" className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>

        <Option selected={mode !== "delete"} onSelect={() => setMode(suspended ? "restore" : "suspend")} tone="warn"
          title={suspended ? "Restablecer el acceso" : "Suspender el acceso"}
          text={suspended
            ? "Los usuarios vuelven a poder iniciar sesión y los procesos automáticos se reanudan."
            : "Nadie de la organización podrá iniciar sesión y los procesos automáticos se detienen. Los datos quedan intactos. Reversible en cualquier momento."}>
          {mode === "suspend" && (
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo (opcional, queda en auditoría)" maxLength={500}
              className="mt-3 w-full text-sm px-3 py-2 rounded-lg border border-border bg-background" onClick={(e) => e.stopPropagation()} />
          )}
        </Option>

        <Option selected={mode === "delete"} onSelect={() => setMode("delete")} tone="err"
          title="Eliminar definitivamente"
          text="Se borra todo lo que pertenece a la organización. Recuperable durante 30 días; después se purga, archivos incluidos.">
          {footprint && (
            <dl className="mt-3 text-[13px] divide-y divide-border/60">
              {[
                ["Usuarios y sesiones", num(footprint.users)],
                ["Documentos AP, historial y excepciones", num(footprint.documents)],
                ["Casos y archivos de contratos", `${num(footprint.cases)} · ${num(footprint.contractFiles)} archivos`],
                ["Conexiones ERP, subsidiarias y catálogos", `${footprint.connections} · ${footprint.subsidiaries} · ${num(footprint.catalogItems)} ítems`],
                ["Informes de gastos", num(footprint.expenseReports)],
                ["Webhooks, API keys y ajustes de features", `${footprint.webhooks} · ${footprint.apiKeys} · ${footprint.featureOverrides}`],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 py-1.5"><dt className="text-muted-foreground">{k}</dt><dd className="tabular-nums">{v}</dd></div>
              ))}
            </dl>
          )}
          {mode === "delete" && (
            <label className="block mt-3 text-[13px]" onClick={(e) => e.stopPropagation()}>
              Para confirmar, escribe el slug <strong className="font-semibold">{org.slug}</strong>
              <input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={org.slug} autoComplete="off"
                className="mt-1.5 w-full text-sm px-3 py-2.5 rounded-lg border border-border bg-background" />
            </label>
          )}
        </Option>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex items-center justify-between gap-3 pt-1">
          <span className="text-xs text-muted-foreground">Queda registrado en Auditoría con tu nombre.</span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} disabled={busy} className="h-9 px-4 rounded-lg border border-border text-[13px] font-medium text-muted-foreground hover:text-foreground">Cancelar</button>
            <button type="button" onClick={run} disabled={busy || !canRun}
              className={cn("h-9 px-4 rounded-lg text-[13px] font-medium text-white disabled:opacity-45 inline-flex items-center gap-2",
                mode === "delete" ? "bg-destructive" : mode === "restore" ? "bg-primary" : "bg-[oklch(0.55_0.14_80)]")}>
              {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {mode === "delete" ? "Eliminar organización" : mode === "restore" ? "Restablecer acceso" : "Suspender acceso"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Option({ selected, onSelect, tone, title, text, children }: { selected: boolean; onSelect: () => void; tone: "warn" | "err"; title: string; text: string; children?: React.ReactNode }) {
  const ring = tone === "err" ? "border-destructive shadow-[0_0_0_3px_oklch(0.50_0.20_25_/_0.08)]" : "border-[oklch(0.70_0.14_80)] shadow-[0_0_0_3px_oklch(0.62_0.16_85_/_0.10)]";
  return (
    <div role="radio" aria-checked={selected} tabIndex={0} onClick={onSelect} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(); } }}
      className={cn("rounded-xl border p-5 flex gap-4 cursor-pointer bg-background", selected ? ring : "border-border")}>
      <span className={cn("mt-0.5 w-[18px] h-[18px] rounded-full border-2 shrink-0 relative", selected ? (tone === "err" ? "border-destructive" : "border-[oklch(0.62_0.16_85)]") : "border-border")}>
        {selected && <span className={cn("absolute inset-[3px] rounded-full", tone === "err" ? "bg-destructive" : "bg-[oklch(0.62_0.16_85)]")} />}
      </span>
      <div className="flex-1 min-w-0">
        <div className={cn("font-semibold", tone === "err" && "text-destructive")}>{title}</div>
        <div className="text-[13px] text-muted-foreground mt-0.5">{text}</div>
        {children}
      </div>
    </div>
  );
}
