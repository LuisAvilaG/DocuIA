import { isProductActive } from "@/lib/products";
import { orgTimeZone } from "@/lib/org-time-zone";
import { friendlyError } from "@/lib/ap/friendly-error";
import { caseVerdict, findingLevel } from "@/lib/contracts/validate";
import { redirect, notFound } from "next/navigation";
import { canApprove } from "@/lib/auth/permissions";
import Link from "next/link";
import { getTenantSession } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { contractAiAnalysisResults, contractArchiveDocuments, contractCases, contractDocuments, contractValidations, contractFlows, orgUsers, tenantAuditLog } from "@/db/schema";
import { and, eq, asc, inArray, or, sql } from "drizzle-orm";
import { FileText } from "lucide-react";
import { ActionLink, CaseStatusPill, Notice, SectionTitle, StageNav, StatusPill, type Stage } from "@/components/kit";
import { cn } from "@/lib/utils";
import { CaseActions } from "./actions";
import type { CaseDoc } from "./case-documents";
import { CaseDocuments } from "./case-documents-lazy";
import { CaseChecks } from "./case-checks-lazy";
import type { CheckAnalysis, CheckFinding } from "./case-checks";
import { evidenceFromQuotes, type EvidenceRef } from "@/lib/contracts/evidence";
import { CaseProcessingRefresh } from "./case-processing-refresh";
import { getFeature, isFeatureEnabled } from "@/lib/features";
import { flowGraphSchema } from "@/lib/contracts/flow";
import { CaseActivity, type CaseActivityItem } from "./case-activity";
import { caseApprovalRules } from "@/lib/contracts/approval-state";
import { canAccessTenantArea } from "@/lib/auth/permissions";
import { ResubmitPanel } from "./resubmit-panel";
import { RetryAnalysis } from "./retry-analysis";
import { CaseCalculations, evidenceKey, summarizeCalculations } from "./case-calculations";
import { DecisionPanel } from "./decision-panel";
import type { CalculationResult } from "@/lib/contracts/calculations";
import { calculationsWithOperation } from "@/lib/contracts/revalidate";
import { OutputDownloads } from "./output-downloads";

const pretty = (k: string) => k.replace(/[_.]/g, " ").replace(/\s+/g, " ").trim().replace(/^\w/, (c) => c.toUpperCase());
const nf = (n: number) => n.toLocaleString("es-CO", { maximumFractionDigits: 6 });
const listEs = new Intl.ListFormat("es", { type: "conjunction" });

/** One line of «Lo que vas a decidir»: what it is, what it says and where to see it whole. */
function SummaryRow({ title, link, children }: { title: string; link?: { label: string; href: string }; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 items-baseline gap-x-4.5 gap-y-1.5 border-t border-border py-4 first-of-type:border-foreground md:grid-cols-[150px_minmax(0,1fr)_auto]">
      <b className="text-sm font-semibold">{title}</b>
      <div className="min-w-0 text-[13.5px]">{children}</div>
      {link ? <Link href={link.href} className="text-[13px] font-semibold text-link hover:underline">{link.label}</Link> : <span />}
    </div>
  );
}

export default async function ContractCasePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ etapa?: string }> }) {
  const { id } = await params;
  const { etapa } = await searchParams;
  const session = await getTenantSession({ area: "contracts" });
  // Access tokens are intentionally short lived. Preserve the case URL so the
  // login page can refresh the tenant session and return the user here instead
  // of looking like the case unexpectedly signed them out.
  if (!session) redirect(`/login?returnTo=${encodeURIComponent(`/cases/${id}`)}`);
  // Same gate as the list of cases: a case stays out of reach once the product is off.
  if (!(await isProductActive(session.orgId, "contract_intelligence"))) redirect("/dashboard");

  const kase = await db.query.contractCases.findFirst({
    where: and(eq(contractCases.id, id), eq(contractCases.organizationId, session.orgId)),
  });
  if (!kase) notFound();

  // Dates below are formatted on the server (UTC): they need the client's zone.
  const timeZone = await orgTimeZone(session.orgId);
  const [documents, validations, analyses, validationsEnabled, generationEnabled, requestsEnabled, approvalFeature, activeFlow, auditRows, users] = await Promise.all([
    db.query.contractDocuments.findMany({ where: eq(contractDocuments.caseId, id) }),
    db.query.contractValidations.findMany({ where: eq(contractValidations.caseId, id) }),
    db.query.contractAiAnalysisResults.findMany({ where: eq(contractAiAnalysisResults.caseId, id) }),
    isFeatureEnabled(session.orgId, "contract_advanced_validations"),
    isFeatureEnabled(session.orgId, "contract_document_generation"),
    isFeatureEnabled(session.orgId, "contract_document_requests").catch(() => false),
    getFeature(session.orgId, "contract_approval_workflow"),
    kase.flowId ? db.query.contractFlows.findFirst({
      where: and(eq(contractFlows.id, kase.flowId), eq(contractFlows.organizationId, session.orgId)),
      columns: { id: true, name: true, graphJson: true },
    }) : Promise.resolve(null),
    // Only the events of this case: the page reloads every few seconds while
    // the case is analysed, and the whole log of the organization was read each time.
    db.query.tenantAuditLog.findMany({
      where: and(
        eq(tenantAuditLog.organizationId, session.orgId),
        or(eq(tenantAuditLog.resourceId, id), sql`${tenantAuditLog.metadata}->>'caseId' = ${id}`),
      ),
      columns: { id: true, userId: true, userEmail: true, action: true, resourceId: true, metadata: true, createdAt: true },
      orderBy: [asc(tenantAuditLog.createdAt)],
    }),
    db.query.orgUsers.findMany({
      where: eq(orgUsers.organizationId, session.orgId),
      columns: { id: true, email: true, fullName: true },
    }),
  ]);

  const approvalRules = await caseApprovalRules(session.orgId, id).catch(() => null);
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
    documents?: Array<{ documentId: string; typeWarning?: string }>;
    decision?: { action?: string; reason?: string | null; byEmail?: string | null; at?: string | null; override?: boolean; support?: { name?: string } } | null;
    calculations?: CalculationResult[];
    documentRequest?: { to: string; reason: string; documents: string[]; message?: string; at: string; byEmail?: string | null; emailSent?: boolean };
    flow?: { snapshot?: { version?: number | null } };
  };
  // Versión del flujo con la que se analizó el caso (los casos anteriores al historial no la tienen).
  const flowVersion = typeof result.flow?.snapshot?.version === "number" ? result.flow.snapshot.version : null;
  const calculations = Array.isArray(result.calculations) ? result.calculations : [];
  const docs: CaseDoc[] = documents.map((d) => ({
    id: d.id, originalName: d.originalName, mimeType: d.mimeType, detectedType: d.detectedType,
    extractedJson: (d.extractedJson ?? {}) as Record<string, unknown>,
    citationsJson: (d.citationsJson ?? {}) as Record<string, unknown>,
    detectedText: d.detectedText,
  }));

  // Verdict from validations.
  const verdict: "ok" | "warn" | "block" | null = validations.length ? caseVerdict(validations) : null;
  const VERDICT = {
    ok:    { text: "Sin observaciones" },
    warn:  { text: "Con advertencias" },
    block: { text: "Con bloqueos" },
  };
  // Hallazgos numerados: bloqueos, luego advertencias, luego lo que no se pudo verificar.
  const rank = (v: (typeof validations)[number]) => (v.ok === false ? 0 : 2) + (v.severity === "block" ? 0 : 1);
  const findings: CheckFinding[] = validations
    .filter((v) => findingLevel(v) !== null)
    .sort((a, b) => rank(a) - rank(b) || a.id - b.id)
    .map((v) => ({
      id: v.id, ruleName: v.ruleName ?? "Validación", severity: (v.severity ?? "warn") as CheckFinding["severity"], subject: v.subject, status: v.status,
      ok: v.ok, reason: v.reason ?? "", ai: v.subject === "Análisis con IA",
      // Casos anteriores a la evidencia por página: solo la cita en texto.
      evidence: Array.isArray(v.evidenceJson) ? v.evidenceJson as EvidenceRef[] : evidenceFromQuotes([v.citation]),
    }));
  const passedChecks = validations.filter((v) => v.ok === true).map((v) => ({ id: v.id, ruleName: v.ruleName ?? "Validación", subject: v.subject, status: v.status }));
  // Informative rules that did not pass: never a finding (the header and the
  // stage already say so), but listed apart so nothing the analysis saw is hidden.
  const infoNotes = validations.filter((v) => v.ok !== true && findingLevel(v) === null)
    .map((v) => ({ id: v.id, ruleName: v.ruleName ?? "Validación", subject: v.subject, reason: v.reason ?? "", verified: v.ok !== null }));
  const checkDocs = docs.map((d) => ({
    id: d.id, name: d.originalName || d.detectedType || "Documento",
    kind: ((d.mimeType ?? "").includes("pdf") ? "pdf" : (d.mimeType ?? "").startsWith("image/") ? "image" : "other") as "pdf" | "image" | "other",
  }));

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
  const blocks = validations.filter((v) => findingLevel(v) === "block").length;
  const warns = validations.filter((v) => findingLevel(v) === "warn").length;
  const unknownDocs = docs.filter((d) => !d.detectedType || d.detectedType === "unknown").length;
  // Documentos subidos en una casilla que la IA no reconoce como de ese tipo.
  const typeWarnings = (Array.isArray(result.documents) ? result.documents : [])
    .filter((d) => d.typeWarning)
    .map((d) => ({ name: docs.find((x) => x.id === d.documentId)?.originalName ?? "Un documento", text: d.typeWarning! }));
  // "Por decidir" only where someone decides: without the approval workflow an
  // analysed case is finished ("Analizado") and nothing waits on anyone.
  const analysed = kase.status === "validated" || kase.status === "review";
  const deciding = analysed && approvalFeature.isEnabled;
  const waitingDocs = kase.status === "awaiting_documents";
  const stages: Stage[] = [
    { key: "docs", label: "Documentos", detail: isProcessing ? "Leyendo…" : `${totalFields} datos · ${docs.length} documento${docs.length === 1 ? "" : "s"}`, state: isProcessing ? "run" : kase.status === "failed" ? "err" : unknownDocs || typeWarnings.length ? "warn" : "ok", href: "?etapa=docs" },
    calculations.length
      ? { key: "calc", label: "Cálculos", detail: `${calculations.length} resultado${calculations.length === 1 ? "" : "s"}`, state: calculations.every((c) => c.status === "ok") ? "ok" : "warn", href: "?etapa=calc" }
      : { key: "calc", label: "Cálculos", detail: "Sin cálculos", state: "off" },
    !validationsEnabled
      ? { key: "checks", label: "Validaciones", detail: "No aplica", state: "off" }
      : isProcessing ? { key: "checks", label: "Validaciones", detail: "Pendiente", state: "off" }
      : { key: "checks", label: "Validaciones", detail: blocks ? `${blocks} bloqueo${blocks === 1 ? "" : "s"}${warns ? ` · ${warns} a revisar` : ""}` : warns ? `${warns} a revisar` : validations.length ? "Sin observaciones" : "Sin reglas", state: blocks ? "err" : warns ? "warn" : "ok", href: "?etapa=checks" },
    decided
      ? { key: "dec", label: "Decisión", detail: [rejected ? "Rechazado" : "Aprobado", result.decision?.byEmail].filter(Boolean).join(" · "), state: rejected ? "err" : "ok", href: "?etapa=dec" }
      : waitingDocs ? { key: "dec", label: "Decisión", detail: "Esperando documentos", state: "now", href: "?etapa=dec" }
      : !approvalFeature.isEnabled ? { key: "dec", label: "Decisión", detail: "No aplica", state: "off" }
      : { key: "dec", label: "Decisión", detail: deciding ? "Pendiente" : "Después del análisis", state: deciding ? "now" : "off", href: deciding ? "?etapa=dec" : undefined },
    !generationEnabled
      ? { key: "doc", label: "Documento", detail: "No aplica", state: "off" }
      : result.outputKey ? { key: "doc", label: "Documento", detail: "Generado", state: "ok", href: "?etapa=doc" }
      : { key: "doc", label: "Documento", detail: approvalFeature.isEnabled ? "Al aprobar" : "Al terminar", state: "off", href: analysed || decided ? "?etapa=doc" : undefined },
  ];
  const valid = new Set([...stages.filter((st) => st.href).map((st) => st.key), "activity"]);
  const fallback = isProcessing || kase.status === "failed" ? "docs"
    : decided ? (result.outputKey ? "doc" : "dec")
    : validationsEnabled && validations.length ? "checks" : "docs";
  const tab = etapa && valid.has(etapa) ? etapa : fallback;
  const caseTitle = kase.title || `Caso ${kase.id.slice(0, 8)}`;
  const statusPill = analysed
    ? <StatusPill tone={blocks ? "err" : warns ? "warn" : "ok"}>{deciding ? "Por decidir" : "Analizado"}{blocks ? ` · ${blocks} bloqueo${blocks === 1 ? "" : "s"}` : ""}</StatusPill>
    : <CaseStatusPill status={kase.status} detail={(kase.status === "approved" || kase.status === "generated") && result.outputKey ? "documento generado" : null} />;
  const creator = kase.createdBy ? userNames.get(kase.createdBy) : null;
  const isWord = result.outputMime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

  // ── Lo que muestran Cálculos, Validaciones y Decisión ──────────────────
  // Cases analysed before the operation was kept get it from a fresh evaluation (no write).
  const shownCalculations = (tab === "calc" || tab === "dec") && calculations.some((c) => !c.parts)
    ? await calculationsWithOperation(kase, calculations, documents, analyses).catch(() => calculations)
    : calculations;
  const docNames: Record<string, string> = {};
  for (const d of docs) if (d.detectedType) docNames[d.detectedType] ??= d.originalName || d.detectedType;
  // Page of each quote the validations already located, for the «Dónde» of a calculation.
  const quotePages: Record<string, number> = {};
  for (const v of validations) {
    for (const e of (Array.isArray(v.evidenceJson) ? v.evidenceJson : []) as EvidenceRef[]) {
      if (e?.page && typeof e.quote === "string") quotePages[evidenceKey(e.quote)] = e.page;
    }
  }
  const checkAnalyses: CheckAnalysis[] = analyses.map((a) => {
    const rows = (Array.isArray(a.itemsJson) ? a.itemsJson as unknown[] : []).flatMap((entry) => {
      const raw = entry as { values?: unknown; evidence?: unknown } | null;
      if (!raw || typeof raw.values !== "object" || raw.values === null) return [];
      const values = Object.fromEntries(Object.entries(raw.values as Record<string, unknown>).map(([k, v]) => [k, v === null || v === undefined ? "" : String(v)]));
      return [{ values, evidence: typeof raw.evidence === "string" && raw.evidence.trim() ? raw.evidence : null }];
    });
    return {
      id: a.id, ruleName: a.ruleName, passed: a.outcome === "pass", summary: a.summary, rows,
      columns: rows[0] ? Object.keys(rows[0].values) : [],
      citations: Array.isArray(a.citationsJson) ? (a.citationsJson as unknown[]).filter((c): c is string => typeof c === "string" && c.trim().length > 0) : [],
    };
  });
  // What is still open, in words: the bar under Cálculos and Validaciones and the summary of Decisión.
  const unverified = findings.filter((f) => f.ok === null).length;
  const toReview = Math.max(0, warns - unverified);
  const openParts = [
    blocks ? `${blocks} bloqueo${blocks === 1 ? "" : "s"}` : null,
    toReview ? `${toReview} hallazgo${toReview === 1 ? "" : "s"} por revisar` : null,
    unverified ? `${unverified} hallazgo${unverified === 1 ? "" : "s"} sin verificar` : null,
  ].filter((part): part is string => part !== null);
  const openText = openParts.length ? `${blocks + warns === 1 ? "Queda" : "Quedan"} ${listEs.format(openParts)}.` : validations.length ? "Sin observaciones." : null;
  const canManage = canApprove(session.role, "contracts");
  const when = (at: string | Date) => new Date(at).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone });
  const decisionSteps = (approvalRules?.steps ?? []).map((st) => {
    const signed = approvalRules!.done.find((d) => d.stepKey === st.key);
    return {
      key: st.key, label: st.label,
      who: st.approvers.mode === "any" ? "cualquier persona con permiso" : `${st.approvers.userIds.length} persona${st.approvers.userIds.length === 1 ? "" : "s"} asignada${st.approvers.userIds.length === 1 ? "" : "s"}`,
      signed: signed ? `Aprobó ${userNames.get(signed.byId) ?? signed.byEmail ?? "—"} · ${when(signed.at)}` : null,
    };
  });
  const outputName = parsedFlow?.success ? parsedFlow.data.nodes.find((node) => node.kind === "generate")?.data.name ?? null : null;
  // The summary of Decisión lists every result in one line: name, factor and value.
  const summaryResults = summarizeCalculations(shownCalculations);
  // Documentos and Validaciones use the whole width, each half with its own scroll.
  const fullWidth = (tab === "checks" && validations.length > 0) || (tab === "docs" && docs.length > 0);
  const notices = (
    <>
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
          <p className="mt-1 text-[13.5px]">{friendlyError(kase.errorMessage?.split("\n")[0]) ?? "Ocurrió un error al analizar los documentos."}</p>
          <p className="mt-2 text-[13px] text-muted-foreground">Si fue una falla pasajera, vuelve a analizarlo. Si se repite, revisa que los documentos sean los que pide el flujo o pide a un administrador que revise el flujo.</p>
          {canAccessTenantArea(session.role, { area: "contracts", permission: "write" }) && <RetryAnalysis caseId={kase.id} />}
        </div>
      )}

      {waitingDocs && (
        <ResubmitPanel caseId={kase.id} request={result.documentRequest ?? null}
          documents={docs.map((d) => ({ id: d.id, label: d.originalName || d.detectedType || "Documento" }))}
          canWrite={canAccessTenantArea(session.role, { area: "contracts", permission: "write" })}
          canCancel={canManage} />
      )}
    </>
  );
  const typeNotice = tab === "docs" && typeWarnings.length > 0 ? (
    <Notice tone="warn" title={typeWarnings.length === 1 ? "Un documento no parece del tipo con que se subió" : `${typeWarnings.length} documentos no parecen del tipo con que se subieron`}>
      <ul className="mt-1 space-y-0.5">{typeWarnings.map((w) => <li key={w.name}><b className="font-medium">{w.name}:</b> {w.text}</li>)}</ul>
      <p className="mt-1">Si es el documento equivocado, pide el correcto o crea el caso de nuevo.</p>
    </Notice>
  ) : null;
  const hasNotices = isProcessing || kase.status === "failed" || waitingDocs || typeNotice !== null;

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
          {[activeFlow ? `${activeFlow.name}${flowVersion ? ` v${flowVersion}` : ""}${configuredValidations !== null ? ` · ${configuredValidations} control${configuredValidations === 1 ? "" : "es"}` : ""}` : null, `creado ${new Date(kase.createdAt).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone })}`, creator ? `por ${creator}` : null].filter(Boolean).join(" · ")}
        </p>
        <StageNav className="mt-4.5" label="Etapas del caso" stages={stages} current={tab} aux={[{ key: "activity", label: "Actividad", href: "?etapa=activity", count: activity.length }]} />
      </div>

      {fullWidth ? (
        <div className="mt-4.5 flex min-h-0 flex-1 flex-col overflow-y-auto border-t border-border lg:overflow-hidden">
          {hasNotices && <div className="flex shrink-0 flex-col gap-5 border-b border-border px-6 py-5.5 md:px-8">{notices}{typeNotice}</div>}
          {tab === "docs"
            ? <CaseDocuments documents={docs} canTrain={session.role === "admin"} />
            : <CaseChecks docs={checkDocs} findings={findings} passed={passedChecks} notes={infoNotes} analyses={checkAnalyses} verdict={verdict ? VERDICT[verdict].text : undefined} />}
        </div>
      ) : (
      <div className="mt-4.5 min-h-0 flex-1 overflow-y-auto border-t border-border">
        <div className={cn("flex flex-col gap-5 px-6 py-5.5 md:px-8", tab === "calc" ? "mx-auto max-w-[1044px]" : tab === "dec" ? "mx-auto max-w-[1184px]" : "max-w-[1100px]")}>
          {notices}
          {typeNotice}

          {tab === "docs" && <p className="text-sm text-muted-foreground">{isProcessing ? "Los documentos aparecen aquí cuando termina la lectura." : "Este caso no tiene documentos."}</p>}

          {tab === "calc" && <CaseCalculations calculations={shownCalculations} docNames={docNames} pages={quotePages} />}

          {tab === "checks" && (
            <section className="flex flex-col gap-4">
              <SectionTitle title="Validaciones" />
              <p className="text-sm text-muted-foreground">Este flujo no tiene controles. Se agregan en el editor del flujo.</p>
            </section>
          )}

          {!waitingDocs && tab === "dec" && (
            <div className="flex flex-wrap items-start gap-7">
              <section aria-labelledby="sum-h" className="flex min-w-0 flex-[999_1_520px] flex-col">
                <h2 id="sum-h" className="mb-3 text-[17px] font-semibold tracking-[-0.015em]">{decided ? "Lo que se decidió" : "Lo que vas a decidir"}</h2>
                <SummaryRow title="Documentos" link={{ label: "Ver datos", href: "?etapa=docs" }}>
                  <ul className="flex flex-col gap-1.5">
                    {docs.map((d) => {
                      const count = Object.keys(d.extractedJson).length;
                      return <li key={d.id}>{d.originalName || d.detectedType || "Documento"}<span className="block text-[12.5px] text-muted-foreground">{count} dato{count === 1 ? "" : "s"} leído{count === 1 ? "" : "s"}</span></li>;
                    })}
                    {docs.length === 0 && <li className="text-muted-foreground">Sin documentos.</li>}
                  </ul>
                </SummaryRow>
                {summaryResults.length > 0 && (
                  <SummaryRow title="Cálculos" link={{ label: "Ver operación", href: "?etapa=calc" }}>
                    <ul className="flex flex-col gap-[5px]">
                      {summaryResults.slice(0, 8).map((row) => (
                        <li key={row.key} className="flex justify-between gap-3.5">
                          <span className="min-w-0">{row.name}</span>
                          <span className={cn("whitespace-nowrap font-semibold tabular-nums", row.value === null && "text-tone-warn")}>{row.value === null ? "Por revisar" : nf(row.value)}</span>
                        </li>
                      ))}
                      {summaryResults.length > 8 && <li className="text-[12.5px] text-muted-foreground">y {summaryResults.length - 8} más</li>}
                    </ul>
                  </SummaryRow>
                )}
                {validationsEnabled && (
                  <SummaryRow title="Validaciones" link={validations.length ? { label: "Ver en el documento", href: "?etapa=checks" } : undefined}>
                    {findings.length > 0 ? (
                      <>
                        <StatusPill tone={blocks ? "err" : "warn"} className="mb-1.5">{listEs.format(openParts)}</StatusPill>
                        <ul className="flex flex-col gap-1">
                          {findings.slice(0, 3).map((f) => <li key={f.id}>{f.ruleName}{f.reason ? `: ${f.reason.split(/(?<=[.!?])\s/)[0]}` : ""}</li>)}
                          {findings.length > 3 && <li className="text-[12.5px] text-muted-foreground">y {findings.length - 3} más</li>}
                        </ul>
                      </>
                    ) : validations.length ? (
                      <><StatusPill tone="ok" className="mb-1.5">Sin observaciones</StatusPill><span className="block text-[12.5px] text-muted-foreground">{validations.length} control{validations.length === 1 ? "" : "es"} revisado{validations.length === 1 ? "" : "s"}</span></>
                    ) : <span className="text-muted-foreground">Este flujo no tiene controles.</span>}
                  </SummaryRow>
                )}
                {decided ? (
                  generationEnabled && (
                    <SummaryRow title="Documento" link={result.outputKey ? { label: "Ver documento", href: "?etapa=doc" } : undefined}>
                      {result.outputKey ? "Generado." : rejected ? "No se genera: el caso fue rechazado." : "Todavía no se ha generado."}
                    </SummaryRow>
                  )
                ) : (
                  <SummaryRow title="Al aprobar">
                    {generationEnabled
                      ? <>Se genera el documento del flujo.{outputName && <span className="block text-[12.5px] text-muted-foreground">{outputName}</span>}</>
                      : "El caso queda aprobado. Este flujo no genera documento."}
                  </SummaryRow>
                )}
              </section>

              <DecisionPanel caseId={kase.id} caseTitle={caseTitle} status={kase.status} verdict={validationsEnabled ? verdict : null} decision={result.decision}
                hasOutput={Boolean(result.outputKey)} generationEnabled={generationEnabled} approvalEnabled={approvalFeature.isEnabled} allowOverride={approvalFeature.config.allow_override !== false}
                canManage={canManage} steps={decisionSteps} openFindings={blocks + warns} requestsEnabled={requestsEnabled} />
            </div>
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

          {tab === "activity" && <CaseActivity items={activity} timeZone={timeZone} />}
        </div>
      </div>
      )}

      {/* La decisión siempre a la vista: ya no hay botones al fondo de una página larga. */}
      {deciding && (tab === "docs" || tab === "calc" || tab === "checks") && (
        <div className={cn("flex shrink-0 flex-wrap items-center gap-3 border-t px-6 py-3 md:px-8", openParts.length ? "border-[#EBD9AE] bg-tone-warn-bg" : "border-border bg-card")}>
          <p className="min-w-[240px] flex-1 text-[13.5px]"><b className="font-semibold">Por decidir.</b>{openText ? ` ${openText}` : ""}</p>
          <ActionLink href="?etapa=dec">{canManage ? "Revisar y decidir" : "Ver la decisión"}</ActionLink>
        </div>
      )}
    </div>
  );
}
