import { findingLevel } from "@/lib/contracts/validate";
import { redirect } from "next/navigation";
import { canApprove } from "@/lib/auth/permissions";
import { getTenantSession } from "@/lib/auth/jwt";
import { isProductActive } from "@/lib/products";
import { getFeature, isFeatureEnabled } from "@/lib/features";
import { db } from "@/lib/db";
import { contractCases, contractDocuments, contractFlows, contractValidations, orgUsers } from "@/db/schema";
import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import { ApprovalsClient, type ApprovalCase } from "./approvals-client";
import { summarizeCalculations } from "../[id]/case-calculations";
import type { CalculationResult } from "@/lib/contracts/calculations";
import { caseApprovalRules, caseTurn } from "@/lib/contracts/approval-state";
import { loadApprovalPeople } from "@/lib/approval-map/state";
import { orgTimeZone } from "@/lib/org-time-zone";

type Decision = { action?: string; reason?: string | null; byEmail?: string | null; byId?: string | null; at?: string | null; override?: boolean; acknowledged?: number[]; support?: { name?: string } };

export default async function ContractApprovalsPage() {
  const session = await getTenantSession({ area: "contracts" });
  if (!session) redirect("/login");
  if (!(await isProductActive(session.orgId, "contract_intelligence"))) redirect("/dashboard");
  const approvalFeature = await getFeature(session.orgId, "contract_approval_workflow");
  if (!approvalFeature.isEnabled) redirect("/contracts/dashboard");
  if (!canApprove(session.role, "contracts")) redirect("/cases");

  // Por decidir: solo casos con la validación terminada. Decididos: últimos 90 días.
  // eslint-disable-next-line react-hooks/purity
  const since = new Date(Date.now() - 90 * 86_400_000);
  // Two queries: the 90 days and the row limit are for decided cases only. A
  // case waiting for a decision stays in the inbox however old it is.
  const columns = { id: true, title: true, status: true, flowId: true, createdBy: true, createdAt: true, updatedAt: true, resultJson: true } as const;
  const [pendingRows, decidedRows] = await Promise.all([
    db.query.contractCases.findMany({
      where: and(eq(contractCases.organizationId, session.orgId), eq(contractCases.status, "validated")),
      columns, orderBy: [desc(contractCases.updatedAt)], limit: 500,
    }),
    db.query.contractCases.findMany({
      where: and(
        eq(contractCases.organizationId, session.orgId),
        inArray(contractCases.status, ["approved", "generated", "rejected"]),
        gte(contractCases.updatedAt, since),
      ),
      columns, orderBy: [desc(contractCases.updatedAt)], limit: 300,
    }),
  ]);
  const rows = [...pendingRows, ...decidedRows];
  const ids = rows.map((r) => r.id);
  const [flows, documents, validations, users, validationsEnabled, requestsEnabled] = await Promise.all([
    db.query.contractFlows.findMany({ where: eq(contractFlows.organizationId, session.orgId), columns: { id: true, name: true } }),
    ids.length ? db.query.contractDocuments.findMany({ where: inArray(contractDocuments.caseId, ids), columns: { id: true, caseId: true, originalName: true, mimeType: true }, orderBy: [asc(contractDocuments.createdAt)] }) : Promise.resolve([]),
    ids.length ? db.query.contractValidations.findMany({ where: inArray(contractValidations.caseId, ids), columns: { caseId: true, ok: true, severity: true, ruleName: true, subject: true, reason: true } }) : Promise.resolve([]),
    db.query.orgUsers.findMany({ where: eq(orgUsers.organizationId, session.orgId), columns: { id: true, fullName: true, email: true } }),
    isFeatureEnabled(session.orgId, "contract_advanced_validations"),
    isFeatureEnabled(session.orgId, "contract_document_requests").catch(() => false),
  ]);

  const flowNames = new Map(flows.map((f) => [f.id, f.name]));
  const userNames = new Map(users.map((u) => [u.id, u.fullName || u.email]));
  const timeZone = await orgTimeZone(session.orgId);
  const stamp = (at: string) => new Date(at).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone });

  // A quién le toca cada caso por decidir y su recorrido de firmas (mapa de
  // aprobaciones o reglas del flujo). Las personas y roles se leen una vez.
  const rulesEnabled = await isFeatureEnabled(session.orgId, "contract_approval_rules").catch(() => false);
  const people = rulesEnabled && pendingRows.length ? await loadApprovalPeople(session.orgId) : undefined;
  const pendingRules = new Map(await Promise.all(pendingRows.map(async (row) =>
    [row.id, rulesEnabled ? await caseApprovalRules(session.orgId, row.id, people).catch(() => null) : null] as const)));
  const docsByCase = new Map<string, typeof documents>();
  for (const d of documents) docsByCase.set(d.caseId, [...(docsByCase.get(d.caseId) ?? []), d]);

  const cases: ApprovalCase[] = rows.flatMap((row) => {
    const result = (row.resultJson ?? {}) as { decision?: Decision | null; outputKey?: string; outputMime?: string; calculations?: CalculationResult[] };
    const results = summarizeCalculations(Array.isArray(result.calculations) ? result.calculations : []);
    const decision = result.decision ?? null;
    const group: ApprovalCase["group"] | null = row.status === "validated" ? "pending"
      : row.status === "rejected" || decision?.action === "reject" ? "rejected"
      : decision?.action === "approve" || row.status === "approved" ? "approved" : null;
    if (!group) return [];
    const checks = validationsEnabled ? validations.filter((v) => v.caseId === row.id) : [];
    const failing = checks.filter((v) => findingLevel(v) !== null);
    const rules = group === "pending" ? pendingRules.get(row.id) ?? null : null;
    const turn = group === "pending" ? caseTurn(rules, { id: session.sub, role: session.role }, row.createdBy, failing.some((v) => findingLevel(v) === "block")) : null;
    let current = true;
    const route = (rules?.steps ?? []).map((st) => {
      const signed = rules!.done.find((d) => d.stepKey === st.key);
      const state = signed ? "done" as const : current ? "now" as const : "later" as const;
      if (!signed) current = false;
      const names = st.approvers.userIds.map((id) => userNames.get(id) ?? "—");
      return {
        key: st.key, label: st.label, state,
        who: signed ? `${userNames.get(signed.byId) ?? signed.byEmail ?? "—"} · ${stamp(signed.at)}`
          : st.blockedReason ?? (names.length ? names.slice(0, 3).join(" o ") + (names.length > 3 ? ` y ${names.length - 3} más` : "") : "Nadie puede firmarlo hoy"),
        note: signed ? null : st.note ?? null,
        mine: !signed && st.approvers.userIds.includes(session.sub),
      };
    });
    return [{
      id: row.id,
      group,
      title: row.title || `Caso ${row.id.slice(0, 8)}`,
      flowName: row.flowId ? flowNames.get(row.flowId) ?? null : null,
      documentCount: docsByCase.get(row.id)?.length ?? 0,
      // Only a case waiting for a decision shows its documents; a decided one shows what was generated.
      documents: group === "pending" ? (docsByCase.get(row.id) ?? []).map((d) => ({ id: d.id, name: d.originalName || "Documento", mime: d.mimeType })) : [],
      createdBy: row.createdBy ? userNames.get(row.createdBy) ?? null : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      blockerCount: failing.filter((v) => findingLevel(v) === "block").length,
      warningCount: failing.filter((v) => findingLevel(v) === "warn").length,
      unverified: checks.filter((v) => v.ok === null).length,
      findings: failing.sort((a, b) => (findingLevel(a) === "block" ? 0 : 1) - (findingLevel(b) === "block" ? 0 : 1)).slice(0, 6)
        .map((v) => ({ severity: findingLevel(v) === "block" ? "block" as const : "warn" as const, title: v.ruleName ?? v.subject, detail: v.reason ?? v.subject })),
      decision: decision ? {
        by: decision.byEmail ?? (decision.byId ? userNames.get(decision.byId) ?? null : null),
        at: decision.at ?? null,
        reason: decision.reason ?? null,
        override: decision.override === true,
        acknowledged: Array.isArray(decision.acknowledged) ? decision.acknowledged.length : 0,
        supportName: decision.support?.name ?? null,
      } : null,
      calculations: results.slice(0, 8).map(({ name, value }) => ({ name, value })),
      moreCalculations: Math.max(0, results.length - 8),
      hasOutput: Boolean(result.outputKey),
      hasWord: result.outputMime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      turn: turn?.turn ?? null,
      waitingFor: turn?.waitingFor ?? null,
      turnReason: turn?.reason ?? null,
      route,
      mapName: rules?.map?.map.name ?? null,
      answers: (rules?.map?.answers ?? []).map((a) => `${a.question}: ${a.answer}`),
    }];
  });
  // Lo que espera una firma, del más antiguo al más nuevo.
  cases.sort((a, b) => a.group === "pending" && b.group === "pending" ? a.updatedAt.localeCompare(b.updatedAt) : 0);

  return <ApprovalsClient cases={cases} allowOverride={approvalFeature.config.allow_override !== false} requestsEnabled={requestsEnabled} />;
}
