import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth/admin";
import { AuditView } from "./audit-view";

export default async function AuditPage() {
  if ((await requireAdminSession()).error) redirect("/admin/login");
  return <AuditView />;
}
