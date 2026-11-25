"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EmptyState, PageFrame, StatusPill, ViewTabs } from "@/components/kit";
import { cn } from "@/lib/utils";
import { DecisionForm } from "../components/decision-form";
import { OutputDownloads } from "../[id]/output-downloads";
import { OutputPreview, SourcePreview } from "../components/output-preview-lazy";
import type { SourceDocument } from "../components/output-preview";

export interface ApprovalCase {
  id: string;
  group: "pending" | "approved" | "rejected";
  title: string;
  flowName: string | null;
  documentCount: number;
  /** The documents uploaded to a case that waits for a decision. */
  documents: SourceDocument[];
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  blockerCount: number;
  warningCount: number;
  unverified: number;
  findings: { severity: "block" | "warn"; title: string; detail: string }[];
  decision: { by: string | null; at: string | null; reason: string | null; override: boolean; acknowledged: number; supportName: string | null } | null;
  /** Results of the case's calculations, one line each. */
  calculations: { name: string; value: number | null }[];
  moreCalculations: number;
  hasOutput: boolean;
  hasWord: boolean;
}

const nf = (n: number) => n.toLocaleString("es-CO", { maximumFractionDigits: 6 });

/** One line of the record of a decision: what it is, what it says and where to see it whole. */
function Row({ title, end, last, children }: { title: string; end?: React.ReactNode; last?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn("grid grid-cols-1 items-baseline gap-x-4.5 gap-y-1 border-b border-border py-3 text-[13.5px] md:grid-cols-[150px_minmax(0,1fr)_auto]", last && "border-b-0")}>
      <b className="font-semibold">{title}</b>
      <div className="min-w-0">{children}</div>
      {end ?? <span />}
    </div>
  );
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

export function ApprovalsClient({ cases, allowOverride, requestsEnabled }: { cases: ApprovalCase[]; allowOverride: boolean; /** Rejecting can also ask the contractor for corrected documents. */ requestsEnabled: boolean }) {
  const router = useRouter();
  const [group, setGroup] = useState<Group>("pending");
  const [flow, setFlow] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const flows = useMemo(() => [...new Set(cases.map((c) => c.flowName).filter((n): n is string => Boolean(n)))].sort(), [cases]);
  const counts = useMemo(() => ({ pending: 0, approved: 0, rejected: 0, ...Object.fromEntries((["pending", "approved", "rejected"] as Group[]).map((g) => [g, cases.filter((c) => c.group === g).length])) }), [cases]);
  const list = cases.filter((c) => c.group === group && (!flow || c.flowName === flow));
  const sel = list.find((c) => c.id === selectedId) ?? list[0] ?? null;

  return (
    <PageFrame wide>
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
        <div className="mt-4.5 grid border-t border-border lg:min-h-[520px] lg:grid-cols-[340px_minmax(0,1fr)]">
          <ul className="border-b border-border lg:border-b-0 lg:border-r" aria-label={GROUP_LABEL[group]}>
            {list.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => setSelectedId(c.id)} aria-current={sel?.id === c.id || undefined}
                  className={cn("flex w-full flex-col gap-1 border-b border-line-soft px-4.5 py-3.5 text-left", sel?.id === c.id ? "bg-white shadow-[inset_3px_0_0_#1E2029]" : "hover:bg-secondary/40")}>
                  <b className="truncate text-sm font-semibold">{c.title}</b>
                  <span className="text-[12.5px] text-muted-foreground">{[c.flowName, `${c.documentCount} documento${c.documentCount === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}</span>
                  {group === "pending" ? (
                    <span className="flex items-center justify-between gap-2">
                      {findingsPill(c)}
                      <span className="text-xs tabular-nums text-muted-foreground">espera {ago(c.updatedAt)}</span>
                    </span>
                  ) : (
                    <span className="text-[12.5px] tabular-nums text-muted-foreground">
                      {group === "rejected" ? "Rechazado" : c.decision?.override ? "Aprobado con excepción" : "Aprobado"} · {when(c.decision?.at ?? c.updatedAt)}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>

          {sel && (
            <section aria-labelledby="ap-title" className="flex flex-wrap items-start gap-7 py-5.5 lg:pl-7">
              <div className="flex min-w-0 flex-[999_1_380px] flex-col">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-foreground pb-2.5">
                  <div className="min-w-0">
                    <h2 id="ap-title" className="text-[17px] font-semibold tracking-[-0.015em]">{sel.title}</h2>
                    <span className="text-[12.5px] text-muted-foreground">{[sel.createdBy && `Subido por ${sel.createdBy}`, when(sel.createdAt), sel.flowName].filter(Boolean).join(" · ")}</span>
                  </div>
                  <Link href={`/contracts/${sel.id}`} className="text-[13px] font-semibold text-link hover:underline">Abrir el caso completo</Link>
                </div>

                {group === "pending" ? (
                  <Row title="Hallazgos">
                    {sel.findings.length === 0 ? (
                      sel.unverified
                        ? <span className="text-muted-foreground">Sin hallazgos, pero {sel.unverified} control{sel.unverified === 1 ? " no se pudo" : "es no se pudieron"} verificar.</span>
                        : <span className="text-muted-foreground">Sin observaciones.</span>
                    ) : (
                      <ul className="flex flex-col gap-2.5">
                        {sel.findings.map((f, i) => (
                          <li key={i} className="flex items-start gap-3">
                            <StatusPill tone={f.severity === "block" ? "err" : "warn"}>{f.severity === "block" ? "Bloqueo" : "A revisar"}</StatusPill>
                            <span className="min-w-0"><b className="block font-semibold">{f.title}</b>{f.detail !== f.title && <span className="text-muted-foreground">{f.detail}</span>}</span>
                          </li>
                        ))}
                        {sel.blockerCount + sel.warningCount > sel.findings.length && <li className="text-[12.5px] text-muted-foreground">y {sel.blockerCount + sel.warningCount - sel.findings.length} más</li>}
                      </ul>
                    )}
                    {(sel.findings.length > 0 || sel.unverified > 0) && (
                      <Link href={`/contracts/${sel.id}?etapa=checks`} className="mt-2 inline-block text-[13px] font-semibold text-link hover:underline">Ver hallazgos en el caso</Link>
                    )}
                  </Row>
                ) : (
                  <>
                    <Row title="Decisión">
                      <span className="inline-flex items-center gap-2.5 text-base font-semibold tracking-[-0.01em]">
                        <span aria-hidden className={cn("size-[9px] rounded-full", group === "approved" ? "bg-tone-ok" : "bg-tone-err")} />
                        {group === "rejected" ? "Rechazado" : sel.decision?.override ? "Aprobado con excepción" : "Aprobado"}
                      </span>
                      <span className="block text-[12.5px] text-muted-foreground">{[sel.decision?.by, when(sel.decision?.at ?? sel.updatedAt)].filter(Boolean).join(" · ")}</span>
                    </Row>
                    <Row title={group === "rejected" ? "Motivo" : sel.decision?.override ? "Justificación" : "Comentario"}>
                      {sel.decision?.reason ? <q>{sel.decision.reason}</q> : <span className="text-muted-foreground">Sin comentario.</span>}
                    </Row>
                    {sel.decision?.override && (
                      <Row title="Excepción">Aprobado pese a {sel.blockerCount || "los"} bloqueo{sel.blockerCount === 1 ? "" : "s"}{sel.decision.acknowledged ? ` · ${sel.decision.acknowledged} validaci${sel.decision.acknowledged === 1 ? "ón revisada" : "ones revisadas"}` : ""}</Row>
                    )}
                    {sel.decision?.supportName && (
                      <Row title="Soporte"><a href={`/api/v1/contracts/cases/${sel.id}/support`} className="text-link hover:underline">{sel.decision.supportName}</a></Row>
                    )}
                    <Row title={group === "rejected" ? "Se rechazó con" : "Se aprobó con"}
                      end={sel.findings.length > 0 ? <Link href={`/contracts/${sel.id}?etapa=checks`} className="text-[13px] font-semibold text-link hover:underline">Ver hallazgos</Link> : undefined}>
                      {sel.findings.length === 0 ? (
                        sel.unverified
                          ? <span className="text-muted-foreground">Sin hallazgos; {sel.unverified} control{sel.unverified === 1 ? " no se pudo" : "es no se pudieron"} verificar.</span>
                          : <span className="text-muted-foreground">Sin observaciones.</span>
                      ) : (
                        <>
                          {findingsPill(sel)}
                          <ul className="mt-1.5 flex flex-col gap-1">
                            {sel.findings.slice(0, 3).map((f, i) => <li key={i}>{f.title}</li>)}
                            {sel.blockerCount + sel.warningCount > 3 && <li className="text-[12.5px] text-muted-foreground">y {sel.blockerCount + sel.warningCount - 3} más</li>}
                          </ul>
                        </>
                      )}
                    </Row>
                  </>
                )}

                {sel.calculations.length > 0 && (
                  <Row title="Cálculos">
                    <ul className="flex flex-col gap-[5px]">
                      {sel.calculations.map((c, i) => (
                        <li key={i} className="flex justify-between gap-3.5">
                          <span className="min-w-0">{c.name}</span>
                          <b className={cn("whitespace-nowrap font-semibold tabular-nums", c.value === null && "text-tone-warn")}>{c.value === null ? "Por revisar" : nf(c.value)}</b>
                        </li>
                      ))}
                      {sel.moreCalculations > 0 && <li className="text-[12.5px] text-muted-foreground">y {sel.moreCalculations} más</li>}
                    </ul>
                  </Row>
                )}

                {group === "pending" && (
                  <Row title="Tu decisión" last>
                    <DecisionForm key={sel.id} caseId={sel.id} caseTitle={sel.title} blocked={sel.blockerCount > 0} allowOverride={allowOverride}
                      openFindings={sel.blockerCount + sel.warningCount} requestsEnabled={requestsEnabled} onDecided={() => router.refresh()} />
                  </Row>
                )}
              </div>

              {group === "pending" ? (
                <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-3 lg:max-w-[360px]">
                  <span className="text-[11.5px] font-semibold uppercase tracking-[0.05em] text-foreground/75">{sel.documents.length > 1 ? `Documentos del caso · ${sel.documents.length}` : "Documento del caso"}</span>
                  <SourcePreview key={sel.id} documents={sel.documents} fullHref={`/contracts/${sel.id}?etapa=docs`} />
                </div>
              ) : sel.hasOutput && (
                <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-3 lg:max-w-[360px]">
                  <span className="text-[11.5px] font-semibold uppercase tracking-[0.05em] text-foreground/75">Documento generado</span>
                  <OutputPreview caseId={sel.id} fullHref={`/contracts/${sel.id}?etapa=doc`} stamp={sel.updatedAt} />
                  <OutputDownloads caseId={sel.id} hasWord={sel.hasWord} variant="buttons" />
                </div>
              )}
            </section>
          )}
        </div>
      )}

    </PageFrame>
  );
}
