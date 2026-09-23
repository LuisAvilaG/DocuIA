import { getTenantSession } from "@/lib/auth/jwt";
import { redirect, notFound } from "next/navigation";
import { db } from "@/lib/db";
import { expenseReports } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { ReportDetail } from "./report-detail";
import { canReviewExpenses } from "@/lib/auth/permissions";

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getTenantSession({ area: "expenses" });
  if (!session) redirect("/login");

  const { id } = await params;

  const report = await db.query.expenseReports.findFirst({
    where: and(
      eq(expenseReports.id, id),
      eq(expenseReports.organizationId, session.orgId),
    ),
    with: {
      items: {
        with: {
          category:   { columns: { id: true, name: true } },
          department: { columns: { id: true, name: true } },
          class:      { columns: { id: true, name: true } },
          documents:  { columns: { id: true, originalName: true, ocrConfidence: true } },
        },
        orderBy: (t, { asc }) => [asc(t.lineNumber)],
      },
    },
  });

  if (!report) notFound();
  if (!canReviewExpenses(session.role) && report.submitterId !== session.sub) notFound();

  const serialized = {
    ...report,
    periodStart: report.periodStart?.toISOString() ?? null,
    periodEnd:   report.periodEnd?.toISOString() ?? null,
    submittedAt: report.submittedAt?.toISOString() ?? null,
  };
  return <ReportDetail report={serialized} isAdmin={session.role === "admin"} isOwner={report.submitterId === session.sub} />;
}
