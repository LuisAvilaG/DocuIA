import { redirect } from "next/navigation";
import { getTenantSession } from "@/lib/auth/jwt";
import { isProductActive } from "@/lib/products";
import { isFeatureEnabled } from "@/lib/features";
import { ArchiveClient } from "./client";

export default async function ArchivePage() {
  const session = await getTenantSession({ area: "contracts" });
  if (!session) redirect("/login");
  if (!await isProductActive(session.orgId, "contract_intelligence") || !await isFeatureEnabled(session.orgId, "contract_reference_archive")) redirect("/contracts/dashboard");
  return <ArchiveClient />;
}
