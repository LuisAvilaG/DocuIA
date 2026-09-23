import { db } from "@/lib/db";
import { exceptionQueue, historyDocuments, itemMappings, orgUsers, subsidiaries } from "@/db/schema";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";

function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function startOfWeek() {
  const x = startOfDay();
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // Monday
  return x;
}

export async function getDashboardData(orgId: string, userId: string) {
  const today = startOfDay();
  const week = startOfWeek();
  const org = eq(historyDocuments.organizationId, orgId);

  const [user, todayRow, waiting, exceptions, exceptionReasons, weekDays, weekRow, learned, recent] = await Promise.all([
    db.query.orgUsers.findFirst({ where: eq(orgUsers.id, userId), columns: { fullName: true } }),
    db.select({
      total: sql<number>`count(*)::int`,
      auto:  sql<number>`count(*) filter (where ${historyDocuments.status} = 'completed' and ${historyDocuments.approvedBy} is null)::int`,
    }).from(historyDocuments).where(and(org, gte(historyDocuments.createdAt, today))),
    db.select({
      status: historyDocuments.status,
      count:  sql<number>`count(*)::int`,
      amount: sql<number>`coalesce(sum(${historyDocuments.total}), 0)::float`,
      oldest: sql<Date | null>`min(${historyDocuments.createdAt})`,
      nextCheck: sql<Date | null>`min(${historyDocuments.nextReceiptCheckAt})`,
    }).from(historyDocuments)
      .where(and(org, inArray(historyDocuments.status, ["review", "pending_approval", "awaiting_receipt"])))
      .groupBy(historyDocuments.status),
    db.select({ count: sql<number>`count(*)::int` }).from(exceptionQueue)
      .where(and(eq(exceptionQueue.organizationId, orgId), eq(exceptionQueue.status, "pending"))),
    db.select({ reason: exceptionQueue.failureReason, count: sql<number>`count(*)::int` }).from(exceptionQueue)
      .where(and(eq(exceptionQueue.organizationId, orgId), eq(exceptionQueue.status, "pending")))
      .groupBy(exceptionQueue.failureReason)
      .orderBy(desc(sql`count(*)`))
      .limit(20),
    db.select({
      day:   sql<number>`((extract(isodow from ${historyDocuments.createdAt}))::int - 1)`,
      count: sql<number>`count(*)::int`,
    }).from(historyDocuments)
      .where(and(org, gte(historyDocuments.createdAt, week)))
      .groupBy(sql`1`),
    db.select({
      completed: sql<number>`count(*) filter (where ${historyDocuments.status} = 'completed')::int`,
      auto:      sql<number>`count(*) filter (where ${historyDocuments.status} = 'completed' and ${historyDocuments.approvedBy} is null)::int`,
    }).from(historyDocuments).where(and(org, gte(historyDocuments.createdAt, week))),
    db.select({ count: sql<number>`count(*)::int` }).from(itemMappings)
      .innerJoin(subsidiaries, eq(subsidiaries.id, itemMappings.subsidiaryId))
      .where(and(eq(subsidiaries.organizationId, orgId), gte(itemMappings.createdAt, week))),
    // PO number read straight from the JSON so the heavy products column is not loaded.
    db.select({
      id: historyDocuments.id, documentType: historyDocuments.documentType, status: historyDocuments.status,
      vendor: historyDocuments.vendor, numDoc: historyDocuments.numDoc, total: historyDocuments.total,
      createdAt: historyDocuments.createdAt, approvedBy: historyDocuments.approvedBy,
      poInternalId: historyDocuments.poInternalId, errorMessage: historyDocuments.errorMessage,
      poTranid: sql<string | null>`(${historyDocuments.products}->'ap_checks'->'po'->'comparison'->>'poTranid')`,
    }).from(historyDocuments).where(org).orderBy(desc(historyDocuments.createdAt)).limit(6),
  ]);

  const byStatus = new Map(waiting.map((w) => [w.status, w]));
  const days = Array.from({ length: 7 }, (_, i) => weekDays.find((d) => Number(d.day) === i)?.count ?? 0);
  const weekTotal = days.reduce((s, n) => s + n, 0);
  const w = weekRow[0];

  return {
    firstName: user?.fullName?.trim().split(/\s+/)[0] ?? null,
    today: { total: todayRow[0]?.total ?? 0, auto: todayRow[0]?.auto ?? 0 },
    review: byStatus.get("review"),
    approval: byStatus.get("pending_approval"),
    receipt: byStatus.get("awaiting_receipt"),
    exceptions: { count: exceptions[0]?.count ?? 0, reasons: exceptionReasons },
    week: { days, total: weekTotal, autoPct: w?.completed ? Math.round((w.auto / w.completed) * 100) : null, learned: learned[0]?.count ?? 0 },
    recent: recent.map((d) => ({ ...d, poLabel: d.poTranid ?? (d.poInternalId ? `#${d.poInternalId}` : null) })),
  };
}

export type DashboardData = Awaited<ReturnType<typeof getDashboardData>>;
