import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getTenantSession } from "@/lib/auth/jwt";
import { requireApAutomation } from "@/lib/products";
import { getFeature, isFeatureEnabled } from "@/lib/features";
import { db } from "@/lib/db";
import { organizations } from "@/db/schema";
import { listVendorCategories, listVendorRules } from "@/lib/workflow/vendor-rules-store";
import { VendorRulesClient } from "./client";

export default async function VendorRulesPage() {
  const session = await getTenantSession({ area: "documents" });
  if (!session) redirect("/login");
  await requireApAutomation(session.orgId);
  const feature = await getFeature(session.orgId, "vendor_rules");
  if (!feature.isEnabled) redirect("/dashboard");

  const [rules, categories, org, poMatching, threeWay, sat] = await Promise.all([
    listVendorRules(session.orgId),
    listVendorCategories(session.orgId),
    db.query.organizations.findFirst({ where: eq(organizations.id, session.orgId), columns: { autoProcessThreshold: true } }),
    isFeatureEnabled(session.orgId, "po_matching"),
    isFeatureEnabled(session.orgId, "three_way_match"),
    isFeatureEnabled(session.orgId, "sat_cfdi_validation"),
  ]);

  return (
    <VendorRulesClient
      initialRules={rules}
      categories={categories}
      canManage={session.role === "admin"}
      maxRules={Math.max(1, Number(feature.config.max_rules) || 50)}
      orgThresholdPct={Math.round((org?.autoProcessThreshold ?? 0.85) * 100)}
      features={{ poMatching, threeWay, sat }}
    />
  );
}
