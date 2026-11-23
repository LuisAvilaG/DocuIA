import { redirect } from "next/navigation";
import { getTenantSession } from "@/lib/auth/jwt";
import { requireApAutomation } from "@/lib/products";
import { isFeatureEnabled } from "@/lib/features";
import { getDashboardData, type DashboardData } from "@/lib/dashboard/ap-dashboard";
import { canUploadDocuments } from "@/lib/ap/upload-access";
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
  const [statsEnabled, exceptionsEnabled, canUpload] = await Promise.all([
    isFeatureEnabled(session.orgId, "advanced_analytics"),
    isFeatureEnabled(session.orgId, "exception_queue"),
    canUploadDocuments(session),
  ]);
  return <DashboardView data={data} statsEnabled={statsEnabled} exceptionsEnabled={exceptionsEnabled} canUpload={canUpload} />;
}
