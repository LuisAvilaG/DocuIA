"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { btn, EmptyState, PageFrame, StatusPill, ViewTabs } from "@/components/kit";
import { cn } from "@/lib/utils";
import { DecisionDialog, type CaseDecisionAction } from "../components/decision-dialog";
import { OutputDownloads } from "../[id]/output-downloads";

export interface ApprovalCase {
  id: string;
  group: "pending" | "approved" | "rejected";
  title: string;
  flowName: string | null;
  documentCount: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  blockerCount: number;
  warningCount: number;
  unverified: number;
  findings: { severity: "block" | "warn"; title: string; detail: string }[];
  decision: { by: string | null; at: string | null; reason: string | null; override: boolean; acknowledged: number; supportName: string | null } | null;
  hasOutput: boolean;
  hasWord: boolean;
}

type Group = ApprovalCase["group"];
const GROUP_LABEL: Record<Group, string> = { pending: "Por decidir", approved: "Aprobados", rejected: "Rechazados" };

function ago(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 60) return `hace ${Math.max(1, min)} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "hace 1 día" : `hace ${d} días`;
}
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

function findingsPill(c: ApprovalCase) {
  if (c.blockerCount) return <StatusPill tone="err">{c.blockerCount} bloqueo{c.blockerCount === 1 ? "" : "s"}</StatusPill>;
  if (c.warningCount) return <StatusPill tone="warn">{c.warningCount} advertencia{c.warningCount === 1 ? "" : "s"}</StatusPill>;
  return <StatusPill tone="ok">Sin observaciones</StatusPill>;
}

export function ApprovalsClient({ cases, allowOverride }: { cases: ApprovalCase[]; allowOverride: boolean }) {
  const router = useRouter();
  const [group, setGroup] = useState<Group>("pending");
  const [flow, setFlow] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ item: ApprovalCase; action: CaseDecisionAction } | null>(null);

  const flows = useMemo(() => [...new Set(cases.map((c) => c.flowName).filter((n): n is string => Boolean(n)))].sort(), [cases]);
  const counts = useMemo(() => ({ pending: 0, approved: 0, rejected: 0, ...Object.fromEntries((["pending", "approved", "rejected"] as Group[]).map((g) => [g, cases.filter((c) => c.group === g).length])) }), [cases]);
  const list = cases.filter((c) => c.group === group && (!flow || c.flowName === flow));
  const sel = list.find((c) => c.id === selectedId) ?? list[0] ?? null;

  return (
    <PageFrame>
      <p className="text-xs font-semibold uppercase tracking-[0.06em] text-link">Contratos</p>
      <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-[-0.025em]">Aprobaciones</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        {counts.pending ? `${counts.pending} caso${counts.pending === 1 ? " espera" : "s esperan"} tu decisión. Cada uno muestra sus hallazgos antes de que decidas.` : "Nada espera tu decisión."}
      </p>

      <div className="mt-6 flex flex-wrap items-end gap-3">
        <ViewTabs className="min-w-0 flex-1" items={(["pending", "approved", "rejected"] as Group[]).map((g) => ({
          key: g, label: GROUP_LABEL[g], count: counts[g], active: group === g, onSelect: () => { setGroup(g); setSelectedId(null); },
        }))} />
        {flows.length > 1 && (
          <select aria-label="Flujo" value={flow} onChange={(e) => { setFlow(e.target.value); setSelectedId(null); }} className="mb-1.5 min-h-[34px] rounded-lg border border-[#D6D2C8] bg-white px-2.5 text-[13px]">
            <option value="">Todos los flujos</option>
            {flows.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        )}
      </div>

      {list.length === 0 ? (
        <EmptyState className="mt-4.5" title={group === "pending" ? "Nada por decidir" : `Sin casos ${GROUP_LABEL[group].toLowerCase()} en los últimos 90 días`}>
          {group === "pending" ? "Los casos aparecen aquí cuando termina su validación." : "Las decisiones quedan registradas con quién, cuándo y por qué."}
        </EmptyState>
      ) : (
        <div className="mt-4.5 grid overflow-hidden rounded-xl border border-border bg-card lg:min-h-[520px] lg:grid-cols-[380px_minmax(0,1fr)]">
          <ul className="border-b border-border lg:border-b-0 lg:border-r" aria-label={GROUP_LABEL[group]}>
            {list.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => setSelectedId(c.id)} aria-current={sel?.id === c.id || undefined}
                  className={cn("flex w-full flex-col gap-1 border-b border-line-soft px-4.5 py-3.5 text-left", sel?.id === c.id ? "bg-tone-info-bg/60" : "hover:bg-secondary/40")}>
                  <b className="truncate text-sm font-semibold">{c.title}</b>
                  <span className="text-xs text-muted-foreground">{[c.flowName, `${c.documentCount} documento${c.documentCount === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}</span>
                  <span className="flex items-center justify-between gap-2">
                    {group === "pending" ? findingsPill(c) : c.decision?.override ? <StatusPill tone="warn">Con excepción</StatusPill> : group === "approved" ? <StatusPill tone="ok">Sin observaciones</StatusPill> : <StatusPill tone="mute">Rechazado</StatusPill>}
                    <span className="text-xs tabular-nums text-muted-foreground">{group === "pending" ? `espera ${ago(c.updatedAt)}` : [c.decision?.by, when(c.decision?.at ?? c.updatedAt)].filter(Boolean).join(" · ")}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {sel && (
            <section aria-labelledby="ap-title" className="flex flex-col gap-4.5 px-7 py-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  {group !== "pending" && <p className="text-xs font-semibold uppercase tracking-[0.06em] text-link">Registro de la decisión</p>}
                  <h2 id="ap-title" className="mt-1 text-xl font-semibold tracking-[-0.02em]">{sel.title}</h2>
                  <p className="mt-1 text-[13px] text-muted-foreground">{[sel.createdBy && `Subido por ${sel.createdBy}`, when(sel.createdAt), sel.flowName].filter(Boolean).join(" · ")}</p>
                </div>
                <Link href={`/contracts/${sel.id}`} className="text-[13.5px] font-semibold text-link hover:underline">Abrir el caso completo →</Link>
              </div>

              {group === "pending" ? (
                <>
                  <div>
                    <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.05em] text-foreground/75">Hallazgos</p>
                    {sel.findings.length === 0 ? (
                      sel.unverified
                        ? <p className="text-[13.5px] text-muted-foreground">Sin hallazgos, pero {sel.unverified} control{sel.unverified === 1 ? " no se pudo" : "es no se pudieron"} verificar. Revísalo en el caso.</p>
                        : <p className="text-[13.5px] text-tone-ok">Todos los controles pasaron.</p>
                    ) : (
                      <ul>
                        {sel.findings.map((f, i) => (
                          <li key={i} className="flex items-start gap-3 border-b border-line-soft py-2.5 text-[13.5px] last:border-0">
                            <StatusPill tone={f.severity === "block" ? "err" : "warn"}>{f.severity === "block" ? "Bloqueo" : "A revisar"}</StatusPill>
                            <span className="min-w-0"><b className="block font-semibold">{f.title}</b>{f.detail !== f.title && <span className="text-muted-foreground">{f.detail}</span>}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {sel.blockerCount + sel.warningCount > sel.findings.length && <p className="mt-1 text-xs text-muted-foreground">y {sel.blockerCount + sel.warningCount - sel.findings.length} más en el caso</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 border-t border-line-soft pt-4">
                    {(!sel.blockerCount || allowOverride) && (
                      <button type="button" className={btn("primary")} onClick={() => setDialog({ item: sel, action: "approve" })}>{sel.blockerCount ? "Aprobar con excepción" : "Aprobar"}</button>
                    )}
                    <button type="button" className={btn("danger")} onClick={() => setDialog({ item: sel, action: "reject" })}>Rechazar</button>
                    {sel.blockerCount > 0 && !allowOverride && <span className="text-[12.5px] text-muted-foreground">Con bloqueos no se puede aprobar: corrige los datos o recházalo.</span>}
                  </div>
                </>
              ) : (
                <>
                  <dl className="grid grid-cols-[120px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13.5px]">
                    <dt className="text-muted-foreground">Decidió</dt><dd>{sel.decision?.by ?? "—"}</dd>
                    <dt className="text-muted-foreground">Cuándo</dt><dd>{when(sel.decision?.at ?? sel.updatedAt)}</dd>
                    {sel.decision?.override && <><dt className="text-muted-foreground">Excepción</dt><dd>Aprobado pese a {sel.blockerCount || "los"} bloqueo{sel.blockerCount === 1 ? "" : "s"}{sel.decision.acknowledged ? ` · ${sel.decision.acknowledged} validaci${sel.decision.acknowledged === 1 ? "ón revisada" : "ones revisadas"}` : ""}</dd></>}
                    {sel.decision?.supportName && <><dt className="text-muted-foreground">Soporte</dt><dd><a href={`/api/v1/contracts/cases/${sel.id}/support`} className="text-link hover:underline">{sel.decision.supportName}</a></dd></>}
                  </dl>
                  {sel.decision?.reason && (
                    <div className="rounded-[10px] bg-background px-4 py-3">
                      <small className="text-xs text-muted-foreground">{group === "rejected" ? "Motivo" : "Justificación"}</small>
                      <q className="mt-1 block text-[13.5px]">{sel.decision.reason}</q>
                    </div>
                  )}
                  {sel.hasOutput && (
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-xs font-semibold uppercase tracking-[0.05em] text-foreground/75">Documento generado</span>
                      <OutputDownloads caseId={sel.id} hasWord={sel.hasWord} />
                    </div>
                  )}
                </>
              )}
            </section>
          )}
        </div>
      )}

      {dialog && (
        <DecisionDialog caseId={dialog.item.id} caseTitle={dialog.item.title} action={dialog.action} blocked={dialog.item.blockerCount > 0}
          allowOverride={allowOverride} onClose={() => setDialog(null)} onComplete={() => { setDialog(null); router.refresh(); }} />
      )}
    </PageFrame>
  );
}
