import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getTenantSession } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { organizations, subscriptions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getAllFeatures } from "@/lib/features";
import { getActiveProductKeys } from "@/lib/products";
import { FeatureProvider } from "@/components/providers/feature-provider";
import { TenantSidebar } from "@/components/tenant/tenant-sidebar";
import { DryRunBanner } from "@/components/tenant/dry-run-banner";

function ipToUint32(ip: string): number {
  return ip.split(".").reduce((acc, o) => (acc << 8) | parseInt(o, 10), 0) >>> 0;
}

function isIpAllowed(ip: string, allowlist: string[]): boolean {
  for (const entry of allowlist) {
    const e = entry.trim();
    if (!e) continue;
    if (e.includes("/")) {
      const [net, bits] = e.split("/");
      const prefix = parseInt(bits, 10);
      if (prefix < 0 || prefix > 32) continue;
      const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
      if ((ipToUint32(ip) & mask) === (ipToUint32(net) & mask)) return true;
    } else if (ip === e) {
      return true;
    }
  }
  return false;
}

export default async function TenantLayout({ children }: { children: React.ReactNode }) {
  const session = await getTenantSession();
  if (!session) redirect("/login");

  // expense_submitter has its own layout under (expenses)
  if (session.role === "expense_submitter") redirect("/expenses");

  const [org, subscription, resolvedFeatures, activeProducts] = await Promise.all([
    db.query.organizations.findFirst({ where: eq(organizations.id, session.orgId) }),
    db.query.subscriptions.findFirst({ where: eq(subscriptions.organizationId, session.orgId) }),
    getAllFeatures(session.orgId),
    getActiveProductKeys(session.orgId),
  ]);

  if (!org) redirect("/login");

  // ── ip_allowlist ───────────────────────────────────────────────────
  const ipFeat = resolvedFeatures.find(f => f.id === "ip_allowlist");
  if (ipFeat?.isEnabled) {
    const allowlist = (ipFeat.config.allowed_ips as string[] | string | undefined) ?? [];
    const list: string[] = Array.isArray(allowlist)
      ? allowlist
      : String(allowlist).split(",");

    if (list.some(e => e.trim())) {
      const hdrs = await headers();
      const clientIp = (
        hdrs.get("x-forwarded-for")?.split(",")[0] ??
        hdrs.get("x-real-ip") ??
        "127.0.0.1"
      ).trim();

      const isLocal = clientIp === "127.0.0.1" || clientIp === "::1" || clientIp === "localhost";
      if (!isLocal && !isIpAllowed(clientIp, list)) {
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
    }
  }

  // ── white_label ────────────────────────────────────────────────────
  const wlFeat = resolvedFeatures.find(f => f.id === "white_label");
  const wlEnabled = wlFeat?.isEnabled ?? false;
  const wlConfig  = wlEnabled ? (wlFeat!.config as {
    company_name?: string;
    logo_url?:     string;
    primary_color?: string;
    hide_branding?: boolean;
  }) : null;

  const featuresMap  = Object.fromEntries(resolvedFeatures.map(f => [f.id, f.isEnabled]));
  const dryRunActive = resolvedFeatures.find(f => f.id === "netsuite_dry_run")?.isEnabled ?? false;

  return (
    <FeatureProvider features={featuresMap}>
      <div className="flex h-screen bg-background text-foreground overflow-hidden">
        <TenantSidebar
          orgName={org.name}
          plan={(subscription?.planId ?? "starter") as "starter" | "growth" | "enterprise"}
          userEmail={session.email}
          userRole={session.role ?? "operator"}
          activeProducts={[...activeProducts]}
          whiteLabel={wlConfig ? {
            companyName:  wlConfig.company_name || undefined,
            logoUrl:      wlConfig.logo_url      || undefined,
            hideBranding: wlConfig.hide_branding ?? false,
          } : undefined}
        />
        <main className="flex-1 flex flex-col overflow-hidden ml-56">
          {dryRunActive && <DryRunBanner isAdmin={session.role === "admin"} />}
          {children}
        </main>
      </div>
    </FeatureProvider>
  );
}
