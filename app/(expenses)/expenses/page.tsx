import { getTenantSession } from "@/lib/auth/jwt";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { expenseReports } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { ExpenseReportsList } from "./reports-list";

export default async function ExpensesPage() {
  const session = await getTenantSession();
  if (!session) redirect("/login");

  const reports = await db.query.expenseReports.findMany({
    where: eq(expenseReports.submitterId, session.sub),
    with: { items: { columns: { id: true, total: true } } },
    orderBy: desc(expenseReports.createdAt),
  });

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-5 border-b border-border flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-foreground">Mis informes de gastos</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{reports.length} informe{reports.length !== 1 ? "s" : ""}</p>
        </div>
        <a
          href="/expenses/new"
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          + Nuevo informe
        </a>
      </div>
      <ExpenseReportsList reports={reports as any} />
    </div>
  );
}
