import { redirect } from "next/navigation";
import { getTenantSession } from "@/lib/auth/jwt";
import { isProductActive } from "@/lib/products";
import { isFeatureEnabled } from "@/lib/features";
import { ApprovalMapEditor } from "./editor-lazy";

export default async function ApprovalMapEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getTenantSession({ area: "contracts" });
  if (!session) redirect("/login");
  if (!(await isProductActive(session.orgId, "contract_intelligence"))) redirect("/dashboard");
  if (!(await isFeatureEnabled(session.orgId, "contract_approval_rules"))) redirect("/contracts/dashboard");
  if (session.role !== "admin") redirect("/cases");
  const { id } = await params;
  return <ApprovalMapEditor mapId={id} />;
}
