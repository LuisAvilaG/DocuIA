import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getSessionFromCookies } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { organizations, subscriptions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getAllFeatures } from "@/lib/features";
import { getActiveProductKeys } from "@/lib/products";
import { FeatureProvider } from "@/components/providers/feature-provider";
import { SessionRefresh } from "@/components/providers/session-refresh";
import { TenantSidebar } from "@/components/tenant/tenant-sidebar";
import { DryRunBanner } from "@/components/tenant/dry-run-banner";
import { isTenantIpAllowed } from "@/lib/security/ip-allowlist";

export default async function TenantLayout({ children }: { children: React.ReactNode }) {
  const rawSession = await getSessionFromCookies({ ignoreIp: true });
  if (!rawSession || rawSession.type !== "org_user" || !rawSession.orgId) redirect("/login");
  const session = rawSession as typeof rawSession & { orgId: string; role: string };
  if (!await isTenantIpAllowed(session.orgId, await headers())) redirect("/unavailable?reason=ip");

  // expense_submitter has its own layout under (expenses)
  if (session.role === "expense_submitter") redirect("/expenses");

  const [org, subscription, resolvedFeatures, activeProducts] = await Promise.all([
    db.query.organizations.findFirst({ where: eq(organizations.id, session.orgId) }),
    db.query.subscriptions.findFirst({ where: eq(subscriptions.organizationId, session.orgId) }),
    getAllFeatures(session.orgId),
    getActiveProductKeys(session.orgId),
  ]);

  if (!org) redirect("/login");

  const featuresMap  = Object.fromEntries(resolvedFeatures.map(f => [f.id, f.isEnabled]));
  const dryRunActive = resolvedFeatures.find(f => f.id === "netsuite_dry_run")?.isEnabled ?? false;

  return (
    <FeatureProvider features={featuresMap}>
      <SessionRefresh />
      <div className="flex h-screen bg-background text-foreground overflow-hidden">
        <TenantSidebar
          orgName={org.name}
          plan={(subscription?.planId ?? "starter") as "starter" | "growth" | "enterprise"}
          userEmail={session.email}
          userRole={session.role ?? "operator"}
          activeProducts={[...activeProducts]}
        />
        <main className="flex-1 flex flex-col overflow-hidden ml-56">
          {dryRunActive && <DryRunBanner isAdmin={session.role === "admin"} />}
          {children}
        </main>
      </div>
    </FeatureProvider>
  );
}
