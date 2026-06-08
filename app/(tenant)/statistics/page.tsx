import { redirect } from "next/navigation";
import { getTenantSession } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { usageDaily, expenseReports, expenseItems, orgUsers } from "@/db/schema";
import { and, eq, gte, sum, count } from "drizzle-orm";
import { isFeatureEnabled } from "@/lib/features";
import { StatisticsClient } from "./client";

export type DayRow = {
  date: string;
  docsProcessed: number;
  docsInvoice: number;
  docsPo: number;
  docsXml: number;
  aiPrimaryCalls: number;
  aiFallbackCalls: number;
  errors: number;
  totalAmount: string;
};

export default async function StatisticsPage() {
  const session = await getTenantSession();
  if (!session) redirect("/login");

  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  let rows: DayRow[] = [];

  try {
    const data = await db
      .select({
        date:            usageDaily.date,
        docsProcessed:   usageDaily.docsProcessed,
        docsInvoice:     usageDaily.docsInvoice,
        docsPo:          usageDaily.docsPo,
        docsXml:         usageDaily.docsXml,
        aiPrimaryCalls:  usageDaily.aiPrimaryCalls,
        aiFallbackCalls: usageDaily.aiFallbackCalls,
        errors:          usageDaily.errors,
        totalAmount:     usageDaily.totalAmount,
      })
      .from(usageDaily)
      .where(
        and(
          eq(usageDaily.organizationId, session.orgId),
          gte(usageDaily.date, thirtyDaysAgo),
        )
      )
      .orderBy(usageDaily.date);

    rows = data.map(r => ({
      date:            r.date,
      docsProcessed:   r.docsProcessed,
      docsInvoice:     r.docsInvoice,
      docsPo:          r.docsPo,
      docsXml:         r.docsXml,
      aiPrimaryCalls:  r.aiPrimaryCalls,
      aiFallbackCalls: r.aiFallbackCalls,
      errors:          r.errors,
      totalAmount:     String(r.totalAmount ?? "0"),
    }));
  } catch (err) {
    console.error("[statistics]", err);
  }

  // Expense stats (only if module is enabled)
  let expenseStats: {
    totalSynced: string;
    reportsBystatus: Record<string, number>;
    submitterCount: number;
  } | null = null;

  try {
    const expenseEnabled = await isFeatureEnabled(session.orgId, "expense_management");
    if (expenseEnabled && session.role === "admin") {
      const [totalRow, byStatus, submitterRow] = await Promise.all([
        db.select({ total: sum(expenseItems.total) })
          .from(expenseItems)
          .innerJoin(expenseReports, eq(expenseItems.reportId, expenseReports.id))
          .where(and(eq(expenseReports.organizationId, session.orgId), eq(expenseReports.status, "synced"))),
        db.select({ status: expenseReports.status, n: count() })
          .from(expenseReports)
          .where(eq(expenseReports.organizationId, session.orgId))
          .groupBy(expenseReports.status),
        db.select({ n: count() })
          .from(orgUsers)
          .where(and(eq(orgUsers.organizationId, session.orgId), eq(orgUsers.role, "expense_submitter"))),
      ]);
      const statusMap: Record<string, number> = {};
      for (const row of byStatus) statusMap[row.status] = Number(row.n);
      expenseStats = {
        totalSynced:     String(totalRow[0]?.total ?? "0"),
        reportsBystatus: statusMap,
        submitterCount:  Number(submitterRow[0]?.n ?? 0),
      };
    }
  } catch (err) {
    console.error("[statistics/expense]", err);
  }

  return <StatisticsClient rows={rows} expenseStats={expenseStats} />;
}
