// One definition of a client's health for the whole platform panel (list,
// expediente, monitor). Health is readiness, not a score out of thin air:
// users exist, the ERP is connected when a product needs it, the catalog was
// synced, and something was processed.
import { db } from "@/lib/db";
import {
  organizations, orgUsers, orgProducts, nsConnections, subsidiaries, catalogItems,
  historyDocuments, contractCases, expenseReports, subscriptions,
} from "@/db/schema";
import { and, eq, gte, inArray, isNull, sql, max, count } from "drizzle-orm";

export interface OrgCheck {
  key: "users" | "erp" | "catalog" | "first_run";
  label: string;
  ok: boolean;
  detail: string;
}

export type HealthTone = "ok" | "warn" | "err" | "mute";

export interface OrgHealth {
  label: string;
  tone: HealthTone;
  score: number;
  checks: OrgCheck[];
  /** First failing check, in priority order. */
  pending: OrgCheck | null;
}

export interface OrgFacts {
  id: string;
  name: string;
  slug: string;
  status: typeof organizations.$inferSelect["status"];
  suspensionReason: string | null;
  deletedAt: Date | null;
  trialEndsAt: Date | null;
  timezone: string;
  billingEmail: string | null;
  activeNsEnvironment: "sandbox" | "production";
  hasAiKey: boolean;
  createdAt: Date;
  planId: string;
  products: Array<{ key: string; status: "active" | "trial" | "disabled"; config: Record<string, unknown> | null; enabledAt: Date }>;
  users: { total: number; admins: number; lastLoginAt: Date | null };
  connections: Array<{ environment: "sandbox" | "production"; accountId: string; status: string; testedAt: Date | null; error: string | null; scriptsInstalled: boolean; catalogScriptId: string | null; processScriptId: string | null }>;
  subsidiaries: { total: number; active: number; items: number };
  usage30: { docs: number; cases: number; reports: number };
  firstRun: { docAt: Date | null; caseAt: Date | null; reportAt: Date | null };
  lastActivityAt: Date | null;
}

const DAY = 86_400_000;

function productKeys(facts: Pick<OrgFacts, "products">): Set<string> {
  return new Set(facts.products.filter((p) => p.status !== "disabled").map((p) => p.key));
}

export function needsErp(facts: Pick<OrgFacts, "products">): boolean {
  const keys = productKeys(facts);
  return keys.has("ap_automation") || keys.has("expense_management");
}

export function healthFromFacts(facts: OrgFacts, now = new Date()): OrgHealth {
  const keys = productKeys(facts);
  const erpRequired = needsErp(facts);
  const activeConn = facts.connections.find((c) => c.environment === facts.activeNsEnvironment);
  const connected = activeConn?.status === "connected";
  const prodConn = facts.connections.find((c) => c.environment === "production");

  const checks: OrgCheck[] = [
    {
      key: "users", label: "Usuarios creados", ok: facts.users.total > 0,
      detail: facts.users.total > 0
        ? `${facts.users.total} usuario${facts.users.total === 1 ? "" : "s"} · ${facts.users.admins} administrador${facts.users.admins === 1 ? "" : "es"}`
        : "Nadie puede entrar al portal todavía",
    },
  ];
  if (erpRequired) {
    checks.push({
      key: "erp", label: `ERP ${facts.activeNsEnvironment} conectado`, ok: connected,
      detail: activeConn
        ? connected
          ? `cuenta ${activeConn.accountId}${activeConn.testedAt ? ` · probada el ${activeConn.testedAt.toLocaleDateString("es-MX")}` : ""}`
          : `cuenta ${activeConn.accountId} · ${activeConn.status === "pending" ? "sin probar" : activeConn.status === "error" ? `error: ${activeConn.error ?? "desconocido"}` : activeConn.status}`
        : "Sin credenciales guardadas",
    });
    if (keys.has("ap_automation")) {
      checks.push({
        key: "catalog", label: "Catálogo sincronizado", ok: facts.subsidiaries.items > 0,
        detail: facts.subsidiaries.items > 0
          ? `${facts.subsidiaries.active} subsidiaria${facts.subsidiaries.active === 1 ? "" : "s"} · ${facts.subsidiaries.items.toLocaleString("es-MX")} ítems`
          : facts.subsidiaries.total > 0 ? "Subsidiarias sin ítems" : "Sin subsidiarias",
      });
    }
  }
  const firstRunOk = Boolean(
    (keys.has("ap_automation") && facts.firstRun.docAt) ||
    (keys.has("contract_intelligence") && facts.firstRun.caseAt) ||
    (keys.has("expense_management") && facts.firstRun.reportAt),
  );
  const firstRunLabel = keys.has("ap_automation") ? "Primer documento procesado"
    : keys.has("contract_intelligence") ? "Primer caso analizado"
    : "Primer informe de gastos";
  const firstAt = facts.firstRun.docAt ?? facts.firstRun.caseAt ?? facts.firstRun.reportAt;
  checks.push({
    key: "first_run", label: firstRunLabel, ok: firstRunOk,
    detail: firstRunOk && firstAt ? `desde el ${firstAt.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" })}` : "Aún sin actividad",
  });

  const passed = checks.filter((c) => c.ok).length;
  const score = Math.round((passed / checks.length) * 100);
  const pending = checks.find((c) => !c.ok) ?? null;

  if (facts.deletedAt) return { label: "Eliminada", tone: "mute", score, checks, pending };
  if (facts.status === "suspended") return { label: "Suspendida", tone: "mute", score, checks, pending };
  if (facts.status === "churned") return { label: "Cancelada", tone: "mute", score, checks, pending };

  const trialDaysLeft = facts.status === "trial" && facts.trialEndsAt
    ? Math.ceil((facts.trialEndsAt.getTime() - now.getTime()) / DAY)
    : null;
  if (trialDaysLeft !== null && trialDaysLeft <= 7 && !firstRunOk) return { label: "En riesgo", tone: "err", score, checks, pending };
  if (!pending) return { label: "Lista", tone: "ok", score, checks, pending };
  if (pending.key === "users") return { label: "Sin usuarios", tone: "warn", score, checks, pending };
  if (pending.key === "erp") {
    // A sandbox-only client whose production creds were never tested shows
    // the same pending state as one with nothing connected.
    return { label: "ERP pendiente", tone: "warn", score, checks, pending };
  }
  if (erpRequired && prodConn && prodConn.status !== "connected" && facts.activeNsEnvironment === "sandbox") {
    return { label: "Onboarding", tone: "warn", score, checks, pending };
  }
  return { label: "Onboarding", tone: "warn", score, checks, pending };
}

/** Loads everything health and the panels need, for all orgs or a subset. */
export async function loadOrgFacts(orgIds?: string[]): Promise<Map<string, OrgFacts>> {
  const since30 = new Date(Date.now() - 30 * DAY);
  const orgFilter = orgIds ? inArray(organizations.id, orgIds) : undefined;

  const orgs = await db.select({
    id: organizations.id, name: organizations.name, slug: organizations.slug, status: organizations.status,
    suspensionReason: organizations.suspensionReason, deletedAt: organizations.deletedAt,
    trialEndsAt: organizations.trialEndsAt, timezone: organizations.timezone, billingEmail: organizations.billingEmail,
    activeNsEnvironment: organizations.activeNsEnvironment, aiKey: organizations.aiApiKeyEncrypted,
    createdAt: organizations.createdAt, planId: subscriptions.planId,
  }).from(organizations)
    .leftJoin(subscriptions, eq(subscriptions.organizationId, organizations.id))
    .where(orgFilter);
  if (!orgs.length) return new Map();
  const ids = orgs.map((o) => o.id);

  const [products, users, connections, subs, items, docs30, cases30, reports30, firstDoc, firstCase, firstReport, lastDoc, lastCase] = await Promise.all([
    db.select().from(orgProducts).where(inArray(orgProducts.organizationId, ids)),
    db.select({
      organizationId: orgUsers.organizationId,
      total: count(),
      admins: sql<number>`count(*) filter (where ${orgUsers.role} = 'admin')::int`,
      lastLoginAt: max(orgUsers.lastLoginAt),
    }).from(orgUsers).where(and(inArray(orgUsers.organizationId, ids), eq(orgUsers.isActive, true))).groupBy(orgUsers.organizationId),
    db.select({
      organizationId: nsConnections.organizationId, environment: nsConnections.environment, accountId: nsConnections.accountId,
      status: nsConnections.connectionStatus, testedAt: nsConnections.connectionTestedAt, error: nsConnections.connectionError,
      scriptsInstalled: nsConnections.scriptsInstalled, catalogScriptId: nsConnections.catalogScriptId, processScriptId: nsConnections.processScriptId,
    }).from(nsConnections).where(and(inArray(nsConnections.organizationId, ids), eq(nsConnections.isActive, true))),
    db.select({
      organizationId: subsidiaries.organizationId,
      total: count(),
      active: sql<number>`count(*) filter (where ${subsidiaries.isActive})::int`,
    }).from(subsidiaries).where(inArray(subsidiaries.organizationId, ids)).groupBy(subsidiaries.organizationId),
    db.select({ organizationId: subsidiaries.organizationId, items: count(catalogItems.id) })
      .from(subsidiaries).leftJoin(catalogItems, eq(catalogItems.subsidiaryId, subsidiaries.id))
      .where(inArray(subsidiaries.organizationId, ids)).groupBy(subsidiaries.organizationId),
    db.select({ organizationId: historyDocuments.organizationId, n: count() }).from(historyDocuments)
      .where(and(inArray(historyDocuments.organizationId, ids), gte(historyDocuments.createdAt, since30))).groupBy(historyDocuments.organizationId),
    db.select({ organizationId: contractCases.organizationId, n: count() }).from(contractCases)
      .where(and(inArray(contractCases.organizationId, ids), gte(contractCases.createdAt, since30))).groupBy(contractCases.organizationId),
    db.select({ organizationId: expenseReports.organizationId, n: count() }).from(expenseReports)
      .where(and(inArray(expenseReports.organizationId, ids), gte(expenseReports.createdAt, since30))).groupBy(expenseReports.organizationId),
    db.select({ organizationId: historyDocuments.organizationId, at: sql<Date | null>`min(${historyDocuments.createdAt})` }).from(historyDocuments)
      .where(and(inArray(historyDocuments.organizationId, ids), eq(historyDocuments.status, "completed"))).groupBy(historyDocuments.organizationId),
    db.select({ organizationId: contractCases.organizationId, at: sql<Date | null>`min(${contractCases.createdAt})` }).from(contractCases)
      .where(inArray(contractCases.organizationId, ids)).groupBy(contractCases.organizationId),
    db.select({ organizationId: expenseReports.organizationId, at: sql<Date | null>`min(${expenseReports.createdAt})` }).from(expenseReports)
      .where(inArray(expenseReports.organizationId, ids)).groupBy(expenseReports.organizationId),
    db.select({ organizationId: historyDocuments.organizationId, at: max(historyDocuments.createdAt) }).from(historyDocuments)
      .where(inArray(historyDocuments.organizationId, ids)).groupBy(historyDocuments.organizationId),
    db.select({ organizationId: contractCases.organizationId, at: max(contractCases.createdAt) }).from(contractCases)
      .where(inArray(contractCases.organizationId, ids)).groupBy(contractCases.organizationId),
  ]);

  const byOrg = <T extends { organizationId: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) { const list = m.get(r.organizationId) ?? []; list.push(r); m.set(r.organizationId, list); }
    return m;
  };
  const one = <T extends { organizationId: string }>(rows: T[]) => new Map(rows.map((r) => [r.organizationId, r]));
  const productsBy = byOrg(products);
  const usersBy = one(users);
  const connBy = byOrg(connections);
  const subsBy = one(subs);
  const itemsBy = one(items);
  const docsBy = one(docs30); const casesBy = one(cases30); const reportsBy = one(reports30);
  const firstDocBy = one(firstDoc); const firstCaseBy = one(firstCase); const firstReportBy = one(firstReport);
  const lastDocBy = one(lastDoc); const lastCaseBy = one(lastCase);
  const toDate = (v: unknown): Date | null => (v instanceof Date ? v : typeof v === "string" ? new Date(v) : null);

  const out = new Map<string, OrgFacts>();
  for (const o of orgs) {
    const u = usersBy.get(o.id);
    const lastLogin = toDate(u?.lastLoginAt);
    const candidates = [lastLogin, toDate(lastDocBy.get(o.id)?.at), toDate(lastCaseBy.get(o.id)?.at)].filter((d): d is Date => Boolean(d));
    out.set(o.id, {
      id: o.id, name: o.name, slug: o.slug, status: o.status, suspensionReason: o.suspensionReason, deletedAt: o.deletedAt,
      trialEndsAt: o.trialEndsAt, timezone: o.timezone, billingEmail: o.billingEmail,
      activeNsEnvironment: o.activeNsEnvironment === "production" ? "production" : "sandbox",
      hasAiKey: Boolean(o.aiKey), createdAt: o.createdAt, planId: o.planId ?? "starter",
      products: (productsBy.get(o.id) ?? []).map((p) => ({ key: p.productKey, status: p.status, config: (p.configJson as Record<string, unknown> | null) ?? null, enabledAt: p.enabledAt })),
      users: { total: Number(u?.total ?? 0), admins: Number(u?.admins ?? 0), lastLoginAt: lastLogin },
      connections: (connBy.get(o.id) ?? []).map((c) => ({
        environment: c.environment, accountId: c.accountId, status: c.status, testedAt: c.testedAt, error: c.error,
        scriptsInstalled: c.scriptsInstalled, catalogScriptId: c.catalogScriptId, processScriptId: c.processScriptId,
      })),
      subsidiaries: { total: Number(subsBy.get(o.id)?.total ?? 0), active: Number(subsBy.get(o.id)?.active ?? 0), items: Number(itemsBy.get(o.id)?.items ?? 0) },
      usage30: { docs: Number(docsBy.get(o.id)?.n ?? 0), cases: Number(casesBy.get(o.id)?.n ?? 0), reports: Number(reportsBy.get(o.id)?.n ?? 0) },
      firstRun: { docAt: toDate(firstDocBy.get(o.id)?.at), caseAt: toDate(firstCaseBy.get(o.id)?.at), reportAt: toDate(firstReportBy.get(o.id)?.at) },
      lastActivityAt: candidates.length ? new Date(Math.max(...candidates.map((d) => d.getTime()))) : null,
    });
  }
  return out;
}

export async function loadOneOrgFacts(orgId: string): Promise<OrgFacts | null> {
  const m = await loadOrgFacts([orgId]);
  return m.get(orgId) ?? null;
}

/** Orgs that still show in the panel (deleted ones are listed separately). */
export function visibleOrgsWhere() {
  return isNull(organizations.deletedAt);
}
