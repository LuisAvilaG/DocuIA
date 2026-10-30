import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth/admin";
import { loadOrgFacts, healthFromFacts } from "@/lib/admin/health";
import { ClientsView, type ClientRow } from "./clients-view";

export default async function ClientsPage() {
  if ((await requireAdminSession()).error) redirect("/admin/login");

  let rows: ClientRow[] = [];
  try {
    const facts = await loadOrgFacts();
    for (const f of facts.values()) {
      if (f.deletedAt) continue;
      const health = healthFromFacts(f);
      rows.push({
        id: f.id, name: f.name, slug: f.slug, status: f.status, planId: f.planId, timezone: f.timezone,
        products: f.products.filter((p) => p.status !== "disabled").map((p) => p.key),
        usage30: f.usage30, users: f.users.total,
        health: { label: health.label, tone: health.tone, pending: health.pending?.label ?? null },
        trialEndsAt: f.trialEndsAt?.toISOString() ?? null,
        lastActivityAt: f.lastActivityAt?.toISOString() ?? null,
        suspensionReason: f.suspensionReason,
      });
    }
    rows = rows.sort((a, b) => (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? "") || a.name.localeCompare(b.name));
  } catch (err) {
    console.error("[admin/clients] load failed", err);
  }

  return <ClientsView rows={rows} />;
}
