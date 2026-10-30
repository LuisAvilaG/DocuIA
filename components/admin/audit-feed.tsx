"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

export interface AuditEvent {
  id: number; at: string; adminId: string; admin: string; action: string; kind: "config" | "access" | "risk";
  text: string; orgId: string | null; orgName: string | null; feature: string | null;
}

export interface AuditFilters { period?: string; adminId?: string; orgId?: string; kind?: string; q?: string }

const KIND_COLOR: Record<AuditEvent["kind"], string> = { config: "bg-primary", access: "bg-[oklch(0.70_0.14_80)]", risk: "bg-destructive" };

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86_400_000);
  const name = d.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
  return diff === 0 ? `Hoy · ${name}` : diff === 1 ? `Ayer · ${name}` : name;
}

/** Chronological feed of platform-admin actions, grouped by day. */
export function AuditFeed({ filters, showOrg = true, onMeta }: { filters: AuditFilters; showOrg?: boolean; onMeta?: (m: { total: number; admins: Array<{ id: string; name: string }> }) => void }) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const key = JSON.stringify(filters);

  async function load(before?: number) {
    setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(filters)) if (v) qs.set(k, v);
      if (before) qs.set("before", String(before));
      const res = await fetch(`/api/admin/audit?${qs.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setEvents((prev) => (before ? [...prev, ...data.events] : data.events));
      setNext(data.nextBefore ?? null);
      onMeta?.({ total: data.total, admins: data.admins });
    } catch {
      setError("No se pudo cargar la auditoría.");
    } finally {
      setLoading(false);
    }
  }

  // Deferred so the loader's setState isn't called synchronously in the effect body.
  useEffect(() => { queueMicrotask(() => { void load(); }); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const groups: Array<{ day: string; items: AuditEvent[] }> = [];
  for (const e of events) {
    const day = dayLabel(e.at);
    const g = groups[groups.length - 1];
    if (g && g.day === day) g.items.push(e); else groups.push({ day, items: [e] });
  }

  return (
    <div className="flex flex-col gap-2">
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!loading && !error && events.length === 0 && <p className="text-sm text-muted-foreground border-t border-foreground pt-4">Sin eventos en este período.</p>}
      {groups.map((g) => (
        <section key={g.day} className="mt-5 first:mt-0">
          <h3 className="text-[11px] font-medium tracking-[0.06em] uppercase text-muted-foreground border-b border-foreground pb-2">{g.day}</h3>
          <ul className="divide-y divide-border/70">
            {g.items.map((e) => (
              <li key={e.id} className={cn("py-3 grid gap-5 items-baseline text-[13px]", showOrg ? "grid-cols-[56px_140px_minmax(0,1fr)_170px]" : "grid-cols-[56px_140px_minmax(0,1fr)]")}>
                <span className="text-xs text-muted-foreground tabular-nums">{new Date(e.at).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}</span>
                <span className="font-medium truncate">{e.admin}</span>
                <span><span className={cn("inline-block w-[7px] h-[7px] rounded-full mr-2 align-middle", KIND_COLOR[e.kind])} />{e.text}</span>
                {showOrg && <span className="text-xs text-muted-foreground text-right truncate">{e.orgId ? <Link href={`/admin/clients/${e.orgId}`} className="hover:text-foreground">{e.orgName ?? e.orgId}</Link> : e.feature ? "Catálogo global" : "—"}</span>}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {loading && <p className="text-xs text-muted-foreground inline-flex items-center gap-2 mt-3"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Cargando…</p>}
      {!loading && next && <button type="button" onClick={() => load(next)} className="text-xs text-primary text-left mt-3">Cargar más</button>}
    </div>
  );
}
