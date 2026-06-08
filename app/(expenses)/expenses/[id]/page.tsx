import { getTenantSession } from "@/lib/auth/jwt";
import { redirect, notFound } from "next/navigation";
import { db } from "@/lib/db";
import { expenseReports } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { ReportDetail } from "./report-detail";

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getTenantSession();
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
  if (session.role !== "admin" && report.submitterId !== session.sub) notFound();

  return <ReportDetail report={report as any} isAdmin={session.role === "admin"} />;
}
