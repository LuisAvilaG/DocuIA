"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Panel, PanelTitle, Main, Label } from "@/components/admin/ui";
import { Field, Select } from "@/components/admin/form";
import { AuditFeed } from "@/components/admin/audit-feed";
import { FilterLink } from "@/components/admin/filter-link";

const PERIODS = [["today", "Hoy"], ["7d", "Últimos 7 días"], ["30d", "Últimos 30 días"], ["90d", "Últimos 90 días"]] as const;
const KINDS = [["", "Todos"], ["config", "Configuración"], ["access", "Acceso y credenciales"], ["risk", "Riesgo"]] as const;
const KIND_DOT: Record<string, string> = { config: "bg-primary", access: "bg-[oklch(0.70_0.14_80)]", risk: "bg-destructive" };

export function AuditView() {
  const [period, setPeriod] = useState("7d");
  const [kind, setKind] = useState("");
  const [adminId, setAdminId] = useState("");
  const [q, setQ] = useState("");
  const [applied, setApplied] = useState("");
  const [meta, setMeta] = useState<{ total: number; admins: Array<{ id: string; name: string }> }>({ total: 0, admins: [] });

  return (
    <>
      <Panel>
        <PanelTitle title="Auditoría" subtitle="Todo lo que hace un administrador de plataforma. Solo lectura." />
        <form onSubmit={(e) => { e.preventDefault(); setApplied(q.trim()); }}>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cliente, admin o acción" aria-label="Buscar en auditoría"
            className="w-full text-[13px] px-3 py-2 rounded-lg border border-border bg-background" />
        </form>
        <div className="flex flex-col gap-0.5">
          <div className="px-2.5 mb-1.5"><Label>Período</Label></div>
          {PERIODS.map(([k, l]) => <FilterLink key={k} active={period === k} onClick={() => setPeriod(k)}>{l}</FilterLink>)}
        </div>
        <div className="flex flex-col gap-0.5">
          <div className="px-2.5 mb-1.5"><Label>Tipo</Label></div>
          {KINDS.map(([k, l]) => (
            <FilterLink key={k} active={kind === k} onClick={() => setKind(k)}>
              <span>{k && <span className={cn("inline-block w-[7px] h-[7px] rounded-full mr-2 align-middle", KIND_DOT[k])} />}{l}</span>
            </FilterLink>
          ))}
        </div>
        <Field label="Administrador">
          <Select value={adminId} onChange={(e) => setAdminId(e.target.value)}>
            <option value="">Todos</option>
            {meta.admins.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </Field>
        <p className="mt-auto text-xs text-muted-foreground">{meta.total} eventos en el período</p>
      </Panel>
      <Main width="max-w-[1100px]">
        <AuditFeed filters={{ period, kind: kind || undefined, adminId: adminId || undefined, q: applied || undefined }} onMeta={setMeta} />
      </Main>
    </>
  );
}
