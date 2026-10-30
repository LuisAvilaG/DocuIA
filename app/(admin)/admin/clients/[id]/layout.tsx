import { notFound, redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth/admin";
import { loadOneOrgFacts, healthFromFacts, needsErp } from "@/lib/admin/health";
import { ClientPanel, type ClientSummary } from "@/components/admin/client-panel";
import { ClientTabs } from "@/components/admin/client-tabs";

export default async function ClientLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  if ((await requireAdminSession()).error) redirect("/admin/login");
  const { id } = await params;
  const facts = await loadOneOrgFacts(id).catch(() => null);
  if (!facts) notFound();
  const health = healthFromFacts(facts);
  const erp = needsErp(facts);

  const summary: ClientSummary = {
    id: facts.id, name: facts.name, slug: facts.slug, status: facts.status, suspensionReason: facts.suspensionReason,
    planId: facts.planId, timezone: facts.timezone, billingEmail: facts.billingEmail, createdAt: facts.createdAt.toISOString(),
    trialEndsAt: facts.trialEndsAt?.toISOString() ?? null, activeNsEnvironment: facts.activeNsEnvironment, hasAiKey: facts.hasAiKey,
    products: facts.products.filter((p) => p.status !== "disabled").map((p) => p.key),
    users: { total: facts.users.total, admins: facts.users.admins },
    health: { label: health.label, tone: health.tone },
  };

  return (
    <>
      <ClientPanel org={summary} />
      <main className="flex-1 min-w-0 px-10 py-8 md:px-12">
        <div className="w-full max-w-[1100px] mx-auto">
        <ClientTabs orgId={id} showErp={erp} erpPending={health.pending?.key === "erp"} />
        <div className="mt-9 flex flex-col gap-10">
          {facts.deletedAt && (
            <p className="text-sm text-destructive">Esta organización está marcada para eliminación desde el {facts.deletedAt.toLocaleDateString("es-MX")}.</p>
          )}
          {children}
        </div>
        </div>
      </main>
    </>
  );
}
