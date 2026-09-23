import { redirect } from "next/navigation";
import { getTenantSession } from "@/lib/auth/jwt";
import { requireApAutomation } from "@/lib/products";
import { isFeatureEnabled } from "@/lib/features";
import { getDashboardData, type DashboardData } from "@/lib/dashboard/ap-dashboard";
import { DashboardView } from "./view";

export default async function TenantDashboardPage() {
  const session = await getTenantSession({ area: "documents" });
  if (!session) redirect("/login");
  await requireApAutomation(session.orgId);

  let data: DashboardData | null = null;
  try {
    data = await getDashboardData(session.orgId, session.sub);
  } catch (err) {
    console.error("[tenant-dashboard]", err);
  }
  const statsEnabled = await isFeatureEnabled(session.orgId, "advanced_analytics");
  return <DashboardView data={data} statsEnabled={statsEnabled} />;
}
