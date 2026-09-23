import { getTenantSession } from "@/lib/auth/jwt";
import { redirect } from "next/navigation";
import { NewReportForm } from "./new-report-form";
import Link from "next/link";

export default async function NewReportPage() {
  const session = await getTenantSession({ area: "expenses" });
  if (!session) redirect("/login");

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-5 border-b border-border">
        <Link href="/expenses" className="text-xs text-muted-foreground hover:text-foreground transition-colors">← Mis gastos</Link>
        <h1 className="text-base font-semibold text-foreground mt-2">Nuevo informe de gastos</h1>
      </div>
      <div className="p-5 max-w-lg">
        <NewReportForm />
      </div>
    </div>
  );
}
