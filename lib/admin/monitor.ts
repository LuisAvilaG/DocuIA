// "Hoy" monitor for the platform home: what every client processed today and
// whether anything looks off, plus the health of the shared machinery.
import { db } from "@/lib/db";
import {
  historyDocuments, contractCases, expenseReports, exceptionQueue, usageDaily, workflowRuntimeLogs,
} from "@/db/schema";
import { and, eq, gte, inArray, sql, count, max } from "drizzle-orm";
import { loadOrgFacts, healthFromFacts } from "./health";

export interface MonitorRow {
  id: string;
  name: string;
  slug: string;
  docsToday: number;
  casesToday: number;
  reportsToday: number;
  inReview: number;
  errorsToday: number;
  fallbackPct: number | null;
  lastActivityAt: string | null;
  /** 12 buckets of one hour each (docs + cases), oldest first. */
  spark: number[];
  status: { label: string; tone: "ok" | "warn" | "err" | "mute" };
  href: string;
}

export interface MonitorData {
  generatedAt: string;
  totals: { orgs: number; active: number; trial: number; suspended: number; docsToday: number; casesToday: number; reportsToday: number; inReview: number; approvals: number; errorsToday: number; fallbackPct: number | null; outliers: number };
  system: Array<{ label: string; tone: "ok" | "warn" | "err"; detail: string }>;
  rows: MonitorRow[];
  idle: number;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function getTodayMonitor(): Promise<MonitorData> {
  const start = startOfToday();
  const since12h = new Date(Date.now() - 12 * 3_600_000);
  const hourAgo = sql<number>`floor(extract(epoch from (now() - ${historyDocuments.createdAt})) / 3600)::int`;
  const facts = await loadOrgFacts();
  const ids = [...facts.keys()];
  const today = isoDay(new Date());

  const [docs, cases, reports, review, exceptions, usage, errors, hourly] = ids.length ? await Promise.all([
    db.select({ organizationId: historyDocuments.organizationId, n: count(), last: max(historyDocuments.createdAt) }).from(historyDocuments)
      .where(and(inArray(historyDocuments.organizationId, ids), gte(historyDocuments.createdAt, start))).groupBy(historyDocuments.organizationId),
    db.select({ organizationId: contractCases.organizationId, n: count(), last: max(contractCases.createdAt) }).from(contractCases)
      .where(and(inArray(contractCases.organizationId, ids), gte(contractCases.createdAt, start))).groupBy(contractCases.organizationId),
    db.select({ organizationId: expenseReports.organizationId, n: count() }).from(expenseReports)
      .where(and(inArray(expenseReports.organizationId, ids), gte(expenseReports.createdAt, start))).groupBy(expenseReports.organizationId),
    db.select({
      organizationId: historyDocuments.organizationId,
      review: sql<number>`count(*) filter (where ${historyDocuments.status} = 'review')::int`,
      approvals: sql<number>`count(*) filter (where ${historyDocuments.status} = 'pending_approval')::int`,
    }).from(historyDocuments).where(and(inArray(historyDocuments.organizationId, ids), inArray(historyDocuments.status, ["review", "pending_approval"]))).groupBy(historyDocuments.organizationId),
    db.select({ organizationId: exceptionQueue.organizationId, n: count() }).from(exceptionQueue)
      .where(and(inArray(exceptionQueue.organizationId, ids), inArray(exceptionQueue.status, ["pending", "in_progress"]))).groupBy(exceptionQueue.organizationId),
    db.select({ organizationId: usageDaily.organizationId, primary: usageDaily.aiPrimaryCalls, fallback: usageDaily.aiFallbackCalls, errors: usageDaily.errors })
      .from(usageDaily).where(and(inArray(usageDaily.organizationId, ids), eq(usageDaily.date, today))),
    db.select({ organizationId: historyDocuments.organizationId, n: count() }).from(historyDocuments)
      .where(and(inArray(historyDocuments.organizationId, ids), eq(historyDocuments.status, "failed"), gte(historyDocuments.updatedAt, start))).groupBy(historyDocuments.organizationId),
    db.select({ organizationId: historyDocuments.organizationId, hour: hourAgo, n: count() })
      .from(historyDocuments).where(and(inArray(historyDocuments.organizationId, ids), gte(historyDocuments.createdAt, since12h)))
      .groupBy(historyDocuments.organizationId, hourAgo),
  ]) : [[], [], [], [], [], [], [], []];

  const one = <T extends { organizationId: string }>(rows: T[]) => new Map(rows.map((r) => [r.organizationId, r]));
  const docsBy = one(docs), casesBy = one(cases), reportsBy = one(reports), reviewBy = one(review), excBy = one(exceptions), usageBy = one(usage), errBy = one(errors);
  const sparkBy = new Map<string, number[]>();
  for (const h of hourly) {
    const arr = sparkBy.get(h.organizationId) ?? new Array(12).fill(0);
    const idx = 11 - Math.min(11, Math.max(0, Number(h.hour)));
    arr[idx] += Number(h.n);
    sparkBy.set(h.organizationId, arr);
  }

  let totalPrimary = 0, totalFallback = 0, outliers = 0;
  const rows: MonitorRow[] = [];
  for (const f of facts.values()) {
    if (f.deletedAt) continue;
    const u = usageBy.get(f.id);
    const primary = Number(u?.primary ?? 0), fallback = Number(u?.fallback ?? 0);
    totalPrimary += primary; totalFallback += fallback;
    const fallbackPct = primary > 0 ? Math.round((fallback / primary) * 100) : null;
    const docsToday = Number(docsBy.get(f.id)?.n ?? 0);
    const casesToday = Number(casesBy.get(f.id)?.n ?? 0);
    const reportsToday = Number(reportsBy.get(f.id)?.n ?? 0);
    const errorsToday = Number(errBy.get(f.id)?.n ?? 0);
    const inReview = Number(reviewBy.get(f.id)?.review ?? 0) + Number(reviewBy.get(f.id)?.approvals ?? 0) + Number(excBy.get(f.id)?.n ?? 0);
    const health = healthFromFacts(f);
    const products = new Set(f.products.filter((p) => p.status !== "disabled").map((p) => p.key));

    let status: MonitorRow["status"];
    if (f.status === "suspended") status = { label: "Suspendida", tone: "mute" };
    else if (fallbackPct !== null && fallbackPct >= 25 && primary >= 5) { status = { label: `Fallback de IA ${fallbackPct} %`, tone: "warn" }; outliers++; }
    else if (errorsToday > 0) status = { label: `${errorsToday} error${errorsToday === 1 ? "" : "es"} hoy`, tone: "err" };
    else if (health.tone === "err") status = { label: health.label, tone: "err" };
    else if (health.pending && health.pending.key !== "first_run") status = { label: health.label, tone: "warn" };
    else if (products.has("ap_automation") && f.activeNsEnvironment === "sandbox") status = { label: "Procesa en sandbox", tone: "warn" };
    else status = { label: "Normal", tone: "ok" };

    const lastToday = [docsBy.get(f.id)?.last, casesBy.get(f.id)?.last].filter(Boolean).map((d) => new Date(d as Date)).sort((a, b) => b.getTime() - a.getTime())[0];
    rows.push({
      id: f.id, name: f.name, slug: f.slug, docsToday, casesToday, reportsToday, inReview, errorsToday, fallbackPct,
      lastActivityAt: (lastToday ?? f.lastActivityAt)?.toISOString() ?? null,
      spark: sparkBy.get(f.id) ?? new Array(12).fill(0),
      status, href: `/admin/clients/${f.id}`,
    });
  }
  // Busiest first, then the ones that need attention, idle ones last.
  rows.sort((a, b) => {
    const act = (r: MonitorRow) => r.docsToday + r.casesToday + r.reportsToday;
    const tone = (r: MonitorRow) => (r.status.tone === "err" ? 2 : r.status.tone === "warn" ? 1 : 0);
    return (act(b) - act(a)) || (tone(b) - tone(a)) || a.name.localeCompare(b.name);
  });
  const active = rows.filter((r) => r.docsToday + r.casesToday + r.reportsToday > 0 || r.status.tone !== "ok");
  const idle = rows.length - active.length;

  const all = [...facts.values()].filter((f) => !f.deletedAt);
  const totals = {
    orgs: all.length,
    active: all.filter((f) => f.status === "active").length,
    trial: all.filter((f) => f.status === "trial").length,
    suspended: all.filter((f) => f.status === "suspended").length,
    docsToday: rows.reduce((s, r) => s + r.docsToday, 0),
    casesToday: rows.reduce((s, r) => s + r.casesToday, 0),
    reportsToday: rows.reduce((s, r) => s + r.reportsToday, 0),
    inReview: review.reduce((s, r) => s + Number(r.review), 0) + exceptions.reduce((s, r) => s + Number(r.n), 0),
    approvals: review.reduce((s, r) => s + Number(r.approvals), 0),
    errorsToday: rows.reduce((s, r) => s + r.errorsToday, 0),
    fallbackPct: totalPrimary > 0 ? Math.round((totalFallback / totalPrimary) * 100) : null,
    outliers,
  };

  return { generatedAt: new Date().toISOString(), totals, system: await systemHealth(), rows: active, idle };
}

async function systemHealth(): Promise<MonitorData["system"]> {
  const out: MonitorData["system"] = [];
  // Queue depth straight from pg-boss' tables; the worker may live in another replica.
  try {
    const res = await db.execute(sql`
      select name,
        count(*) filter (where state = 'created')::int as waiting,
        count(*) filter (where state = 'active')::int as active,
        count(*) filter (where state = 'failed' and completed_on > now() - interval '1 hour')::int as failed_1h,
        max(completed_on) filter (where state = 'completed') as last_done
      from pgboss.job
      where name in ('document-pipeline','contract-pipeline','contract-archive')
      group by name`);
    const rows = (res as unknown as { rows: Array<{ name: string; waiting: number; active: number; failed_1h: number; last_done: string | null }> }).rows ?? [];
    const waiting = rows.reduce((s, r) => s + Number(r.waiting), 0);
    const active = rows.reduce((s, r) => s + Number(r.active), 0);
    const failed = rows.reduce((s, r) => s + Number(r.failed_1h), 0);
    const lastDone = rows.map((r) => (r.last_done ? new Date(r.last_done).getTime() : 0)).sort((a, b) => b - a)[0] ?? 0;
    out.push({ label: "Cola de procesamiento", tone: waiting > 50 ? "warn" : "ok", detail: `${waiting} en espera · ${active} en curso${failed ? ` · ${failed} fallidos en 1 h` : ""}` });
    const ago = lastDone ? Math.round((Date.now() - lastDone) / 60_000) : null;
    out.push({ label: "Worker", tone: ago === null ? "warn" : waiting > 0 && ago > 15 ? "err" : "ok", detail: ago === null ? "sin trabajos completados" : ago < 1 ? "último trabajo hace menos de 1 min" : `último trabajo hace ${ago} min` });
  } catch {
    out.push({ label: "Cola de procesamiento", tone: "warn", detail: "no disponible (pg-boss no responde)" });
  }
  try {
    const since = new Date(Date.now() - 24 * 3_600_000);
    const [row] = await db.select({
      ok: sql<number>`count(*) filter (where ${workflowRuntimeLogs.status} = 'SUCCESS')::int`,
      failed: sql<number>`count(*) filter (where ${workflowRuntimeLogs.status} = 'FAILED')::int`,
    }).from(workflowRuntimeLogs).where(and(gte(workflowRuntimeLogs.createdAt, since), eq(workflowRuntimeLogs.stage, "sync")));
    const ok = Number(row?.ok ?? 0), failed = Number(row?.failed ?? 0);
    out.push({ label: "Sincronizaciones (24 h)", tone: failed > 0 ? "warn" : "ok", detail: ok + failed === 0 ? "ninguna registrada" : `${ok} correctas${failed ? ` · ${failed} fallidas` : ""}` });
  } catch { /* optional */ }
  return out;
}
