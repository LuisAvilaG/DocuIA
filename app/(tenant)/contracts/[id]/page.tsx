import { redirect, notFound } from "next/navigation";
import { canApprove } from "@/lib/auth/permissions";
import Link from "next/link";
import { getTenantSession } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { contractAiAnalysisResults, contractArchiveDocuments, contractCases, contractDocuments, contractValidations, contractFlows, orgUsers, tenantAuditLog } from "@/db/schema";
import { and, eq, asc, inArray } from "drizzle-orm";
import { CheckCircle2, XCircle, MinusCircle, FileText } from "lucide-react";
import { CaseStatusPill, Notice, SectionTitle, StageNav, StatusPill, type Stage } from "@/components/kit";
import { CaseActions } from "./actions";
import { CaseDocuments, type CaseDoc } from "./case-documents";
import { CaseProcessingRefresh } from "./case-processing-refresh";
import { getFeature, isFeatureEnabled } from "@/lib/features";
import { flowGraphSchema } from "@/lib/contracts/flow";
import { CaseActivity, type CaseActivityItem } from "./case-activity";
import { contractStatusLabel } from "@/lib/contracts/status";
import { AiAnalysisResults } from "./ai-analysis-results";
import { OutputDownloads } from "./output-downloads";

const pretty = (k: string) => k.replace(/[_.]/g, " ").replace(/\s+/g, " ").trim().replace(/^\w/, (c) => c.toUpperCase());

type ValidationOutcome = { ok: boolean | null; severity: string | null };
type CalculationItemOutcome = { values: Record<string, string>; value: number | null; status: "ok" | "missing" | "error"; reason?: string };
type CalculationOutcome = { key: string; label: string; value: number | null; status: "ok" | "missing" | "error"; formula: string; reason?: string; items?: CalculationItemOutcome[] };

/**
 * La severidad sólo describe qué ocurre si la regla falla. El distintivo de la
 * tarjeta debe comunicar primero el resultado que obtuvo en este caso.
 */
function getRuleOutcomeTag(items: ValidationOutcome[]) {
  if (items.length > 0 && items.every((item) => item.ok === true)) return { label: "Correcto", tone: "ok" as const };
  const failedItem = items.find((item) => item.ok === false);
  if (failedItem) {
    if (failedItem.severity === "block") return { label: "Bloqueo", tone: "err" as const };
    if (failedItem.severity === "info") return { label: "Info", tone: "mute" as const };
    return { label: "A revisar", tone: "warn" as const };
  }
  return { label: "Sin verificar", tone: "mute" as const };
}

export default async function ContractCasePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ etapa?: string }> }) {
  const { id } = await params;
  const { etapa } = await searchParams;
  const session = await getTenantSession({ area: "contracts" });
  // Access tokens are intentionally short lived. Preserve the case URL so the
  // login page can refresh the tenant session and return the user here instead
  // of looking like the case unexpectedly signed them out.
  if (!session) redirect(`/login?returnTo=${encodeURIComponent(`/cases/${id}`)}`);

  const kase = await db.query.contractCases.findFirst({
    where: and(eq(contractCases.id, id), eq(contractCases.organizationId, session.orgId)),
  });
  if (!kase) notFound();

  const [documents, validations, analyses, validationsEnabled, generationEnabled, approvalFeature, activeFlow, auditRows, users] = await Promise.all([
    db.query.contractDocuments.findMany({ where: eq(contractDocuments.caseId, id) }),
    db.query.contractValidations.findMany({ where: eq(contractValidations.caseId, id) }),
    db.query.contractAiAnalysisResults.findMany({ where: eq(contractAiAnalysisResults.caseId, id) }),
    isFeatureEnabled(session.orgId, "contract_advanced_validations"),
    isFeatureEnabled(session.orgId, "contract_document_generation"),
    getFeature(session.orgId, "contract_approval_workflow"),
    kase.flowId ? db.query.contractFlows.findFirst({
      where: and(eq(contractFlows.id, kase.flowId), eq(contractFlows.organizationId, session.orgId)),
      columns: { id: true, name: true, graphJson: true },
    }) : Promise.resolve(null),
    db.query.tenantAuditLog.findMany({
      where: eq(tenantAuditLog.organizationId, session.orgId),
      columns: { id: true, userId: true, userEmail: true, action: true, resourceId: true, metadata: true, createdAt: true },
      orderBy: [asc(tenantAuditLog.createdAt)],
    }),
    db.query.orgUsers.findMany({
      where: eq(orgUsers.organizationId, session.orgId),
      columns: { id: true, email: true, fullName: true },
    }),
  ]);

  const parsedFlow = activeFlow ? flowGraphSchema.safeParse(activeFlow.graphJson) : null;
  const configuredValidations = parsedFlow?.success
    ? parsedFlow.data.nodes.filter((node) => node.kind === "validate" || node.kind === "reference_lookup").length
    : null;
  const isProcessing = kase.status === "uploaded" || kase.status === "processing";
  const archiveProgress = isProcessing && documents.length > 0
    ? await db.query.contractArchiveDocuments.findMany({ where: and(eq(contractArchiveDocuments.organizationId, session.orgId), inArray(contractArchiveDocuments.caseDocumentId, documents.map((document) => document.id))), columns: { originalName: true, pageCount: true, indexedPages: true, status: true } })
    : [];

  const result = (kase.resultJson ?? {}) as {
    outputKey?: string; outputMime?: string; outputName?: string; missing?: string[];
    decision?: { action?: string; reason?: string | null; byEmail?: string | null; at?: string | null; override?: boolean; support?: { name?: string } } | null;
    calculations?: CalculationOutcome[];
  };
  const calculations = Array.isArray(result.calculations) ? result.calculations : [];
  const docs: CaseDoc[] = documents.map((d) => ({
    id: d.id, originalName: d.originalName, mimeType: d.mimeType, detectedType: d.detectedType,
    extractedJson: (d.extractedJson ?? {}) as Record<string, unknown>,
    citationsJson: (d.citationsJson ?? {}) as Record<string, unknown>,
    detectedText: d.detectedText,
  }));

  // Verdict from validations.
  let verdict: "ok" | "warn" | "block" | null = validations.length ? "ok" : null;
  for (const v of validations) {
    if (v.ok === false && v.severity === "block") { verdict = "block"; break; }
    if (v.ok !== true && v.severity === "warn" && verdict === "ok") verdict = "warn";
  }
  const VERDICT = {
    ok:    { text: "Sin observaciones" },
    warn:  { text: "Con advertencias" },
    block: { text: "Con bloqueos" },
  };
  const ruleGroups = new Map<string, typeof validations>();
  for (const v of validations) { const k = v.ruleName ?? "Validación"; (ruleGroups.get(k) ?? ruleGroups.set(k, []).get(k)!).push(v); }

  const totalFields = docs.reduce((a, d) => a + Object.keys(d.extractedJson).length, 0);
  const userNames = new Map(users.map((user) => [user.id, user.fullName || user.email]));
  const activity: CaseActivityItem[] = auditRows
    .filter((event) => {
      const metadata = (event.metadata ?? {}) as Record<string, unknown>;
      return event.resourceId === id || metadata.caseId === id;
    })
    .map((event) => ({
      id: event.id,
      action: event.action,
      createdAt: event.createdAt.toISOString(),
      actor: event.userEmail ?? (event.userId ? userNames.get(event.userId) ?? null : null),
      metadata: (event.metadata ?? {}) as Record<string, unknown>,
    }));
  // Cases created before the audit events existed remain understandable.
  if (!activity.some((event) => event.action === "contract.case_created")) {
    activity.unshift({ id: `created-${kase.id}`, action: "contract.case_created", createdAt: kase.createdAt.toISOString(), actor: kase.createdBy ? userNames.get(kase.createdBy) ?? null : null });
  }
  if (!activity.some((event) => event.action === "contract.documents_uploaded") && documents.length > 0) {
    activity.splice(1, 0, {
      id: `documents-${kase.id}`,
      action: "contract.documents_uploaded",
      createdAt: documents.reduce((earliest, document) => document.createdAt < earliest ? document.createdAt : earliest, documents[0].createdAt).toISOString(),
      actor: kase.createdBy ? userNames.get(kase.createdBy) ?? null : null,
      metadata: { files: documents.map((document) => document.originalName ?? "Documento") },
    });
  }
  activity.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  // ── Etapas: son la navegación del caso; Actividad va aparte ─────────────
  const decided = result.decision?.action === "approve" || result.decision?.action === "reject" || kase.status === "approved" || kase.status === "rejected";
  const rejected = result.decision?.action === "reject" || kase.status === "rejected";
  const failedChecks = validations.filter((v) => v.ok === false);
  const blocks = failedChecks.filter((v) => v.severity === "block").length;
  const warns = failedChecks.filter((v) => v.severity === "warn").length;
  const unknownDocs = docs.filter((d) => !d.detectedType || d.detectedType === "unknown").length;
  const deciding = kase.status === "validated" || kase.status === "review";
  const stages: Stage[] = [
    { key: "docs", label: "Documentos", detail: isProcessing ? "Leyendo…" : `${totalFields} datos · ${docs.length} documento${docs.length === 1 ? "" : "s"}`, state: isProcessing ? "run" : kase.status === "failed" ? "err" : unknownDocs ? "warn" : "ok", href: "?etapa=docs" },
    calculations.length
      ? { key: "calc", label: "Cálculos", detail: `${calculations.length} resultado${calculations.length === 1 ? "" : "s"}`, state: calculations.every((c) => c.status === "ok") ? "ok" : "warn", href: "?etapa=calc" }
      : { key: "calc", label: "Cálculos", detail: "Sin cálculos", state: "off" },
    !validationsEnabled
      ? { key: "checks", label: "Validaciones", detail: "No aplica", state: "off" }
      : isProcessing ? { key: "checks", label: "Validaciones", detail: "Pendiente", state: "off" }
      : { key: "checks", label: "Validaciones", detail: blocks ? `${blocks} bloqueo${blocks === 1 ? "" : "s"}${warns ? ` · ${warns} a revisar` : ""}` : warns ? `${warns} a revisar` : validations.length ? "Sin observaciones" : "Sin reglas", state: blocks ? "err" : warns ? "warn" : "ok", href: "?etapa=checks" },
    decided
      ? { key: "dec", label: "Decisión", detail: [rejected ? "Rechazado" : "Aprobado", result.decision?.byEmail].filter(Boolean).join(" · "), state: rejected ? "err" : "ok", href: "?etapa=dec" }
      : { key: "dec", label: "Decisión", detail: deciding ? "Pendiente" : "Después del análisis", state: deciding ? "now" : "off", href: deciding ? "?etapa=dec" : undefined },
    !generationEnabled
      ? { key: "doc", label: "Documento", detail: "No aplica", state: "off" }
      : result.outputKey ? { key: "doc", label: "Documento", detail: "Generado", state: "ok", href: "?etapa=doc" }
      : { key: "doc", label: "Documento", detail: approvalFeature.isEnabled ? "Al aprobar" : "Al terminar", state: "off", href: deciding || decided ? "?etapa=doc" : undefined },
  ];
  const valid = new Set([...stages.filter((st) => st.href).map((st) => st.key), "activity"]);
  const fallback = isProcessing || kase.status === "failed" ? "docs"
    : decided ? (result.outputKey ? "doc" : "dec")
    : validationsEnabled && validations.length ? "checks" : "docs";
  const tab = etapa && valid.has(etapa) ? etapa : fallback;
  const caseTitle = kase.title || `Caso ${kase.id.slice(0, 8)}`;
  const statusPill = deciding
    ? <StatusPill tone={blocks ? "err" : warns ? "warn" : "ok"}>Por decidir{blocks ? ` · ${blocks} bloqueo${blocks === 1 ? "" : "s"}` : ""}</StatusPill>
    : <CaseStatusPill status={kase.status} detail={(kase.status === "approved" || kase.status === "generated") && result.outputKey ? "documento generado" : null} />;
  const creator = kase.createdBy ? userNames.get(kase.createdBy) : null;
  const isWord = result.outputMime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {isProcessing && <CaseProcessingRefresh />}
      <div className="px-6 pt-5.5 md:px-8">
        <nav aria-label="Ruta" className="text-[13px]"><Link href="/cases" className="text-link hover:underline">Casos</Link><span className="text-muted-foreground"> / {activeFlow?.name ?? "Sin flujo"}</span></nav>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="mt-1.5 text-2xl font-semibold leading-tight tracking-[-0.025em]">{caseTitle}</h1>
          {statusPill}
        </div>
        <p className="mt-1.5 text-[13px] text-muted-foreground">
          {[activeFlow ? `${activeFlow.name}${configuredValidations !== null ? ` · ${configuredValidations} controles` : ""}` : null, `creado ${new Date(kase.createdAt).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`, creator ? `por ${creator}` : null].filter(Boolean).join(" · ")}
        </p>
        <StageNav className="mt-4.5" label="Etapas del caso" stages={stages} current={tab} aux={[{ key: "activity", label: "Actividad", href: "?etapa=activity", count: activity.length }]} />
      </div>

      <div className="mt-4.5 min-h-0 flex-1 overflow-y-auto border-t border-border">
        <div className="flex max-w-[1100px] flex-col gap-5 px-6 py-5.5 md:px-8">
          {isProcessing && (
            <Notice tone="info" title="Analizando el caso">
              Esta página se actualiza sola; puedes salir y volver cuando quieras.
              {archiveProgress.length > 0 && (
                <ul className="mt-2 space-y-1">{archiveProgress.map((d) => <li key={d.originalName}>{d.originalName}: {d.pageCount ? `${d.indexedPages} de ${d.pageCount} páginas` : "preparando"}</li>)}</ul>
              )}
            </Notice>
          )}
          {kase.status === "failed" && (
            <div role="alert" className="rounded-xl border border-[#E9C6C2] bg-tone-err-bg px-5 py-4">
              <b className="block text-base font-semibold text-tone-err">El análisis no terminó</b>
              <p className="mt-1 text-[13.5px]">{kase.errorMessage?.split("\n")[0] ?? "Ocurrió un error al analizar los documentos."}</p>
              <p className="mt-2 text-[13px] text-muted-foreground">Revisa que los documentos sean los que pide el flujo y crea el caso de nuevo, o pide a un administrador que revise el flujo.</p>
            </div>
          )}

          {tab === "docs" && <CaseDocuments documents={docs} canTrain={session.role === "admin"} />}

          {tab === "calc" && (
            <section>
              <SectionTitle title="Cálculos" aside="con su procedencia" />
              <ul>
                {calculations.map((item) => (
                  <li key={item.key} className="border-b border-line-soft py-3.5 last:border-0">
                    <div className="flex flex-wrap items-baseline justify-between gap-3">
                      <span className="min-w-0"><b className="block text-sm font-semibold">{item.label}</b><span className="text-[12.5px] text-muted-foreground">{item.formula}{item.reason ? ` · ${item.reason}` : ""}</span></span>
                      <b className={`tabular-nums ${item.status === "ok" ? "" : "text-tone-warn"}`}>{item.items?.length ? `${item.items.length} fila${item.items.length === 1 ? "" : "s"}` : item.value === null ? "Por revisar" : item.value.toLocaleString("es-CO", { maximumFractionDigits: 6 })}</b>
                    </div>
                    {item.items?.length ? (
                      <ul className="mt-2 space-y-1 text-[13px] text-muted-foreground">
                        {item.items.map((entry, index) => (
                          <li key={index} className="flex justify-between gap-3"><span className="truncate">{entry.values.amparo || entry.values.nombre || entry.values.concepto || `Elemento ${index + 1}`}</span><span className={entry.status === "ok" ? "tabular-nums text-foreground" : "text-tone-warn"}>{entry.value === null ? "Por revisar" : entry.value.toLocaleString("es-CO", { maximumFractionDigits: 6 })}</span></li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {tab === "checks" && (
            <section className="flex flex-col gap-4">
              <SectionTitle title="Validaciones" aside={verdict ? VERDICT[verdict].text : undefined} />
              {validations.length === 0 ? (
                <p className="text-sm text-muted-foreground">Este flujo no tiene controles. Se agregan en el editor del flujo.</p>
              ) : (
                <ul>
                  {[...ruleGroups.entries()].sort(([, a], [, b]) => rankGroup(a) - rankGroup(b)).map(([ruleName, items]) => {
                    const tag = getRuleOutcomeTag(items);
                    return (
                      <li key={ruleName} className="border-b border-line-soft py-3.5 last:border-0">
                        <div className="flex items-center justify-between gap-3"><b className="min-w-0 truncate text-sm font-semibold">{ruleName}</b><StatusPill tone={tag.tone}>{tag.label}</StatusPill></div>
                        <ul className="mt-1.5 space-y-1">
                          {items.map((v) => {
                            const Icon = v.ok === true ? CheckCircle2 : v.ok === false ? XCircle : MinusCircle;
                            return (
                              <li key={v.id} className="flex items-start gap-2 text-[13px]">
                                <Icon aria-hidden className={`mt-0.5 size-4 shrink-0 ${v.ok === true ? "text-tone-ok" : v.ok === false ? "text-tone-err" : "text-muted-foreground"}`} />
                                <span className="min-w-0"><span className="font-medium">{v.subject}</span>{v.status ? ` · ${contractStatusLabel(v.status)}` : ""}{v.reason && <span className="block text-muted-foreground">{v.reason}</span>}</span>
                              </li>
                            );
                          })}
                        </ul>
                      </li>
                    );
                  })}
                </ul>
              )}
              <AiAnalysisResults analyses={analyses} />
            </section>
          )}

          {(tab === "dec" || (tab === "checks" && deciding)) && (
            <section className={tab === "checks" ? "border-t border-line-soft pt-4" : ""}>
              {tab === "dec" && <SectionTitle title="Decisión" className="mb-3" />}
              <CaseActions caseId={kase.id} caseTitle={caseTitle} status={kase.status} verdict={validationsEnabled ? verdict : null} decision={result.decision} hasOutput={Boolean(result.outputKey)} generationEnabled={generationEnabled} approvalEnabled={approvalFeature.isEnabled} allowOverride={approvalFeature.config.allow_override !== false} canManage={canApprove(session.role, "contracts")} />
            </section>
          )}

          {tab === "doc" && (
            <section className="flex flex-col gap-3">
              <SectionTitle title="Documento generado" />
              {result.outputKey ? (
                <>
                  <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#BFE3D0] bg-tone-ok-bg px-5 py-4">
                    <FileText aria-hidden className="size-5 text-tone-ok" />
                    <span className="min-w-0 flex-1 text-[13.5px] font-semibold">{isWord ? "Documento en Word listo" : "Documento PDF listo"}</span>
                    <OutputDownloads caseId={kase.id} hasWord={isWord} />
                  </div>
                  {result.missing && result.missing.length > 0 && <p className="text-[13px] text-tone-warn">Quedaron sin dato ({result.missing.length}): {result.missing.slice(0, 6).map(pretty).join(", ")}{result.missing.length > 6 ? "…" : ""}</p>}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">{approvalFeature.isEnabled ? "Se genera cuando el caso se aprueba." : "Se genera al terminar la validación."}</p>
              )}
              {!approvalFeature.isEnabled && <CaseActions caseId={kase.id} caseTitle={caseTitle} status={kase.status} verdict={validationsEnabled ? verdict : null} decision={result.decision} hasOutput={Boolean(result.outputKey)} generationEnabled={generationEnabled} approvalEnabled={false} allowOverride={false} canManage={canApprove(session.role, "contracts")} />}
            </section>
          )}

          {tab === "activity" && <CaseActivity items={activity} />}
        </div>
      </div>
    </div>
  );
}

function rankGroup(items: ValidationOutcome[]): number {
  if (items.some((i) => i.ok === false && i.severity === "block")) return 0;
  if (items.some((i) => i.ok === false)) return 1;
  if (items.some((i) => i.ok !== true)) return 2;
  return 3;
}
