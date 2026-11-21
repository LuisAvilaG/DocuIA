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
import { qaModeActive } from "@/lib/features/qa-mode";

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
  const qaFeature    = resolvedFeatures.find(f => f.id === "qa_mode");
  const qaUntil      = qaFeature && qaModeActive(qaFeature.isEnabled, qaFeature.config, org.activeNsEnvironment, new Date(), org.timezone) && activeProducts.has("ap_automation")
    ? new Date(`${String(qaFeature.config.expires_on)}T12:00:00Z`).toLocaleDateString("es-MX", { day: "numeric", month: "short" })
    : null;

  return (
    <FeatureProvider features={featuresMap}>
      <SessionRefresh />
      <div className="flex h-[100dvh] bg-background text-foreground overflow-hidden">
        <TenantSidebar
          orgName={org.name}
          plan={(subscription?.planId ?? "starter") as "starter" | "growth" | "enterprise"}
          userEmail={session.email}
          userRole={session.role ?? "operator"}
          activeProducts={[...activeProducts]}
        />
        <main className="flex-1 min-w-0 flex flex-col overflow-hidden pt-12 lg:pt-0 lg:ml-56">
          {dryRunActive && <DryRunBanner isAdmin={session.role === "admin"} />}
          {qaUntil && (
            <div role="status" className="shrink-0 border-b border-[#EBD9AE] bg-tone-warn-bg px-6 py-2 text-[13px] text-tone-warn">
              <b className="font-semibold">Modo QA activo hasta el {qaUntil}</b> · los documentos se crean en el ERP con número de prueba aunque ya existan.
            </div>
          )}
          {children}
        </main>
      </div>
    </FeatureProvider>
  );
}
