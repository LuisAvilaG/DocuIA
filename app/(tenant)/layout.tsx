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
  const rawSession = await getSessionFromCookies();
  if (!rawSession || rawSession.type !== "org_user" || !rawSession.orgId) redirect("/login");
  const session = rawSession as typeof rawSession & { orgId: string; role: string };
  const requestHeaders = await headers();
  const ipAllowed = await isTenantIpAllowed(session.orgId, requestHeaders);

  // expense_submitter has its own layout under (expenses)
  if (session.role === "expense_submitter") redirect("/expenses");

  const [org, subscription, resolvedFeatures, activeProducts] = await Promise.all([
    db.query.organizations.findFirst({ where: eq(organizations.id, session.orgId) }),
    db.query.subscriptions.findFirst({ where: eq(subscriptions.organizationId, session.orgId) }),
    getAllFeatures(session.orgId),
    getActiveProductKeys(session.orgId),
  ]);

  if (!org) redirect("/login");

  if (!ipAllowed) {
    return (
      <html lang="es">
        <body style={{ fontFamily: "sans-serif", background: "#0f0f11", color: "#e5e5e5", display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", margin: 0 }}>
          <div style={{ textAlign: "center", maxWidth: 360 }}>
            <p style={{ fontSize: 48, margin: "0 0 12px" }}>🔒</p>
            <h1 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 8px" }}>Acceso restringido</h1>
            <p style={{ fontSize: 13, color: "#888", margin: 0 }}>Tu dirección IP no tiene permiso para acceder a este portal. Contacta al administrador.</p>
          </div>
        </body>
      </html>
    );
  }

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
