import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth/admin";
import { FeaturesCatalog } from "./catalog-client";

// Server check like every other admin page: a layout is not re-run on each
// navigation, so the page itself confirms the session.
export default async function FeaturesCatalogPage() {
  if ((await requireAdminSession()).error) redirect("/admin/login");
  return <FeaturesCatalog />;
}
