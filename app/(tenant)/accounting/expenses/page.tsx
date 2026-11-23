import { redirect } from "next/navigation";
import { getTenantSession } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { expenseReports } from "@/db/schema";
import { eq, and, desc, notInArray } from "drizzle-orm";
import { AccountingExpenseList } from "./accounting-list";
import { canReviewExpenses } from "@/lib/auth/permissions";
import { isFeatureEnabled } from "@/lib/features";

export default async function AccountingExpensesPage() {
  const session = await getTenantSession({ area: "expenses" });
  if (!session) redirect("/login");
  if (!canReviewExpenses(session.role) || !await isFeatureEnabled(session.orgId, "expense_management")) redirect("/dashboard");

  let reports: {
    id: string;
    purpose: string;
    status: string;
    submittedAt: string | null;
    approvedAt: string | null;
    createdAt: string;
    syncError: string | null;
    netsuiteExpenseReportId: string | null;
    submitter: { fullName: string | null; email: string };
    items: { id: string; total: string | null; currency: string | null }[];
  }[] = [];

  try {
    const rows = await db.query.expenseReports.findMany({
      where: and(
        eq(expenseReports.organizationId, session.orgId),
        notInArray(expenseReports.status, ["draft"]),
      ),
      with: {
        submitter: { columns: { fullName: true, email: true } },
        items: { columns: { id: true, total: true, currency: true } },
      },
      orderBy: desc(expenseReports.createdAt),
    });

    reports = rows.map((r) => ({
      id:                      r.id,
      purpose:                 r.purpose,
      status:                  r.status,
      submittedAt:             r.submittedAt?.toISOString() ?? null,
      approvedAt:              r.approvedAt?.toISOString() ?? null,
      createdAt:               r.createdAt.toISOString(),
      syncError:               r.syncError,
      netsuiteExpenseReportId: r.netsuiteExpenseReportId,
      submitter:               r.submitter,
      items:                   r.items.map((i) => ({ id: i.id, total: i.total, currency: i.currency })),
    }));
  } catch (err) {
    console.error("[accounting/expenses]", err);
    // An empty list here read as "nothing to review".
    return (
      <div className="p-6">
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          No se pudieron cargar los informes de gastos. Recarga la página; si sigue igual, avisa a soporte.
        </p>
      </div>
    );
  }

  return <AccountingExpenseList reports={reports} />;
}
