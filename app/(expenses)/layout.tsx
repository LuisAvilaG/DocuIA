import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getSessionFromCookies } from "@/lib/auth/jwt";
import { canAccessTenantArea } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { organizations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { isFeatureEnabled } from "@/lib/features";
import { isTenantIpAllowed } from "@/lib/security/ip-allowlist";
import { ExpenseSidebar } from "@/components/expense/expense-sidebar";
import { SessionRefresh } from "@/components/providers/session-refresh";

export default async function ExpenseLayout({ children }: { children: React.ReactNode }) {
  const session = await getSessionFromCookies({ ignoreIp: true });
  if (!session || session.type !== "org_user" || !session.orgId || !session.role) redirect("/login");
  if (!await isTenantIpAllowed(session.orgId, await headers())) redirect("/unavailable?reason=ip");

  // Roles without expenses access belong in the main tenant portal.
  if (!canAccessTenantArea(session.role, { area: "expenses" })) redirect("/dashboard");

  const [org, featureEnabled] = await Promise.all([
    db.query.organizations.findFirst({ where: eq(organizations.id, session.orgId) }),
    isFeatureEnabled(session.orgId, "expense_management"),
  ]);
  if (!org) redirect("/login");
  // Expense submitters have no other portal: sending them to /dashboard would
  // bounce straight back here.
  if (!featureEnabled) redirect(session.role === "expense_submitter" ? "/unavailable?reason=product" : "/dashboard");

  return (
    <div className="flex h-[100dvh] bg-background text-foreground overflow-hidden">
      <SessionRefresh />
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
