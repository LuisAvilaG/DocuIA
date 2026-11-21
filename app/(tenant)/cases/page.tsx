import { findingLevel } from "@/lib/contracts/validate";
import { redirect } from "next/navigation";
import { and, desc, eq, exists, gte, ilike, inArray, sql, type SQL, or, isNull } from "drizzle-orm";
import { getTenantSession } from "@/lib/auth/jwt";
import { canAccessTenantArea } from "@/lib/auth/permissions";
import { isProductActive } from "@/lib/products";
import { isFeatureEnabled } from "@/lib/features";
import { friendlyError } from "@/lib/ap/friendly-error";
import { db } from "@/lib/db";
import { contractCases, contractDocTypes, contractDocuments, contractFlows, contractValidations, orgUsers } from "@/db/schema";
import { CasesView, type CaseListRow, type CaseView } from "./view";

const PAGE_SIZE = 50;
type CaseStatus = (typeof contractCases.status.enumValues)[number];

const VIEWS: Record<Exclude<CaseView, "all" | "findings">, CaseStatus[]> = {
  analyzing: ["uploaded", "processing"],
  decide:    ["review", "validated"],
  done:      ["approved", "generated"],
  waiting:   ["awaiting_documents"],
  rejected:  ["rejected"],
  failed:    ["failed"],
};
const PERIOD_DAYS: Record<string, number | null> = { "30": 30, "90": 90, "365": 365, all: null };

const hasFindings = exists(
  db.select({ one: sql`1` }).from(contractValidations)
    .where(and(eq(contractValidations.caseId, contractCases.id), or(eq(contractValidations.ok, false), isNull(contractValidations.ok)), inArray(contractValidations.severity, ["warn", "block"]))),
);

export default async function CasesPage({ searchParams }: {
  searchParams: Promise<{ view?: string; q?: string; flow?: string; period?: string; owner?: string; page?: string; new?: string }>;
}) {
  const sp = await searchParams;
  const session = await getTenantSession({ area: "contracts" });
  if (!session) redirect("/login");
  if (!(await isProductActive(session.orgId, "contract_intelligence"))) redirect("/dashboard");
  if (!(await isFeatureEnabled(session.orgId, "contract_ai_extraction"))) redirect("/contracts/dashboard");

  const view: CaseView = sp.view === "findings" || (sp.view && sp.view in VIEWS) ? (sp.view as CaseView) : "all";
  const q = (sp.q ?? "").trim().slice(0, 80);
  const period = sp.period && sp.period in PERIOD_DAYS ? sp.period : "90";
  const page = Math.max(1, Math.floor(Number(sp.page) || 1));

  const [flows, users, docTypes] = await Promise.all([
    db.query.contractFlows.findMany({ where: eq(contractFlows.organizationId, session.orgId), columns: { id: true, name: true } }),
    db.query.orgUsers.findMany({ where: eq(orgUsers.organizationId, session.orgId), columns: { id: true, email: true, fullName: true } }),
    db.query.contractDocTypes.findMany({ where: eq(contractDocTypes.organizationId, session.orgId), columns: { key: true, name: true } }),
  ]);
  const flow = sp.flow && flows.some((f) => f.id === sp.flow) ? sp.flow : "";
  const owner = sp.owner && users.some((u) => u.id === sp.owner) ? sp.owner : "";

  const base: SQL[] = [eq(contractCases.organizationId, session.orgId)];
  const days = PERIOD_DAYS[period];
  // Per-request "now" in an async Server Component (intentionally dynamic).
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  if (days) base.push(gte(contractCases.createdAt, new Date(now - days * 86_400_000)));
  if (flow) base.push(eq(contractCases.flowId, flow));
  if (owner) base.push(eq(contractCases.createdBy, owner));
  if (q) base.push(ilike(contractCases.title, `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`));
  const where = view === "all" ? and(...base) : view === "findings" ? and(...base, hasFindings) : and(...base, inArray(contractCases.status, VIEWS[view]));

  const [rows, byStatus, findingsCount] = await Promise.all([
    db.select({ id: contractCases.id, title: contractCases.title, status: contractCases.status, flowId: contractCases.flowId, createdBy: contractCases.createdBy, errorMessage: contractCases.errorMessage, createdAt: contractCases.createdAt, updatedAt: contractCases.updatedAt })
      .from(contractCases).where(where).orderBy(desc(contractCases.updatedAt)).limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE),
    db.select({ status: contractCases.status, n: sql<number>`count(*)::int` }).from(contractCases).where(and(...base)).groupBy(contractCases.status),
    db.$count(contractCases, and(...base, hasFindings)),
  ]);

  const ids = rows.map((r) => r.id);
  const [docs, validations] = ids.length ? await Promise.all([
    db.select({ caseId: contractDocuments.caseId, type: contractDocuments.detectedType }).from(contractDocuments).where(inArray(contractDocuments.caseId, ids)),
    db.select({ caseId: contractValidations.caseId, ok: contractValidations.ok, severity: contractValidations.severity, reason: contractValidations.reason, ruleName: contractValidations.ruleName })
      .from(contractValidations).where(and(inArray(contractValidations.caseId, ids), or(eq(contractValidations.ok, false), isNull(contractValidations.ok)))),
  ]) : [[], []];

  const statusN = new Map(byStatus.map((r) => [r.status, Number(r.n)]));
  const counts: Record<string, number> = Object.fromEntries(Object.entries(VIEWS).map(([k, sts]) => [k, sts.reduce((n, s) => n + (statusN.get(s) ?? 0), 0)]));
  counts.all = [...statusN.values()].reduce((a, b) => a + b, 0);
  counts.findings = findingsCount;
  const total = counts[view] ?? 0;

  const flowName = new Map(flows.map((f) => [f.id, f.name]));
  const userName = new Map(users.map((u) => [u.id, u.fullName || u.email]));
  const typeName = new Map(docTypes.map((t) => [t.key, t.name]));
  const list: CaseListRow[] = rows.map((r) => {
    const types = docs.filter((d) => d.caseId === r.id).map((d) => (d.type ? typeName.get(d.type) ?? d.type : "Sin clasificar"));
    const chips = [...new Map(types.map((t) => [t, types.filter((x) => x === t).length])).entries()].map(([t, n]) => (n > 1 ? `${t} ×${n}` : t));
    const fails = validations.filter((v) => v.caseId === r.id);
    const blocks = fails.filter((v) => findingLevel(v) === "block");
    const warns = fails.filter((v) => findingLevel(v) === "warn");
    const first = blocks[0] ?? warns[0];
    return {
      id: r.id,
      title: r.title ?? "Caso sin título",
      flowName: r.flowId ? flowName.get(r.flowId) ?? "Flujo eliminado" : "Sin flujo",
      docs: chips,
      status: r.status,
      tone: blocks.length ? "err" : warns.length ? "warn" : null,
      detail: r.status === "failed" ? (friendlyError(r.errorMessage?.split("\n")[0]) ?? "El análisis no terminó")
        : blocks.length || warns.length
          ? [blocks.length ? `${blocks.length} bloqueo${blocks.length === 1 ? "" : "s"}` : null, warns.length ? `${warns.length} advertencia${warns.length === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ") + (first?.reason || first?.ruleName ? ` · ${first.reason ?? first.ruleName}` : "")
          : r.status === "review" || r.status === "validated" ? "Sin observaciones" : null,
      owner: r.createdBy ? userName.get(r.createdBy) ?? "—" : "—",
      updatedAt: r.updatedAt.toISOString(),
    };
  });

  const canCreate = canAccessTenantArea(session.role, { area: "contracts", permission: "write" });

  return (
    <CasesView
      rows={list}
      counts={counts}
      total={total}
      page={page}
      pageSize={PAGE_SIZE}
      filters={{ view, q, flow, period, owner }}
      approvalEnabled={await isFeatureEnabled(session.orgId, "contract_approval_workflow")}
      flows={flows.map((f) => ({ id: f.id, name: f.name }))}
      owners={users.map((u) => ({ id: u.id, name: u.fullName || u.email }))}
      canCreate={canCreate}
      openNew={sp.new === "1" && canCreate}
    />
  );
}
