import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth/admin";
import { PRESETS } from "@/lib/contracts/presets";
import { ClientWizard } from "./wizard";

export default async function NewClientPage() {
  if ((await requireAdminSession()).error) redirect("/admin/login");
  return <ClientWizard playbooks={Object.values(PRESETS).map((p) => ({ key: p.key, name: p.name }))} />;
}
