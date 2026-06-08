import { redirect } from "next/navigation";
import { getTenantSession } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { organizations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { isFeatureEnabled } from "@/lib/features";
import { ExpenseSidebar } from "@/components/expense/expense-sidebar";

export default async function ExpenseLayout({ children }: { children: React.ReactNode }) {
  const session = await getTenantSession();
  if (!session) redirect("/login");

  // Only expense_submitter and admin can access this layout
  if (session.role !== "expense_submitter" && session.role !== "admin") {
    redirect("/dashboard");
  }

  const [org, featureEnabled] = await Promise.all([
    db.query.organizations.findFirst({ where: eq(organizations.id, session.orgId) }),
    isFeatureEnabled(session.orgId, "expense_management"),
  ]);
  if (!org) redirect("/login");
  if (!featureEnabled) redirect("/dashboard");

  return (
    <div className="flex h-[100dvh] bg-background text-foreground overflow-hidden">
      <ExpenseSidebar
        orgName={org.name}
        userEmail={session.email}
        userRole={session.role}
      />
      <main className="flex-1 flex flex-col overflow-hidden lg:ml-56">
        {children}
      </main>
    </div>
  );
}
