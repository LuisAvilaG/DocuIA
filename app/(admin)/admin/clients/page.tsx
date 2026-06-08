import Link from "next/link";
import { db } from "@/lib/db";
import {
  organizations, subscriptions, usageDaily,
  onboardingProgress, subsidiaries,
} from "@/db/schema";
import { eq, desc, gte, sql } from "drizzle-orm";
import { Building2, Plus } from "lucide-react";
import { ClientsTable, type ClientRow } from "@/components/admin/clients-table";

function relativeDate(date: Date): string {
  const diff = Math.floor((Date.now() - date.getTime()) / 86400000);
  if (diff === 0) return "hoy";
  if (diff === 1) return "ayer";
  if (diff < 7) return `hace ${diff} días`;
  return date.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}

async function getClients(): Promise<ClientRow[]> {
  try {
    const monthStart = new Date().toISOString().slice(0, 7) + "-01";

    const [orgs, docsRows, subRows] = await Promise.all([
      db
        .select({
          id:          organizations.id,
          name:        organizations.name,
          status:      organizations.status,
          planId:      subscriptions.planId,
          healthScore: onboardingProgress.healthScore,
          updatedAt:   organizations.updatedAt,
        })
        .from(organizations)
        .leftJoin(subscriptions, eq(subscriptions.organizationId, organizations.id))
        .leftJoin(onboardingProgress, eq(onboardingProgress.organizationId, organizations.id))
        .orderBy(desc(organizations.createdAt)),

      db
        .select({
          organizationId: usageDaily.organizationId,
          total: sql<number>`coalesce(sum(${usageDaily.docsProcessed}), 0)::int`,
        })
        .from(usageDaily)
        .where(gte(usageDaily.date, monthStart))
        .groupBy(usageDaily.organizationId),

      db
        .select({
          organizationId: subsidiaries.organizationId,
          count: sql<number>`count(*)::int`,
        })
        .from(subsidiaries)
        .groupBy(subsidiaries.organizationId),
    ]);

    const docsMap = new Map(docsRows.map(d => [d.organizationId, Number(d.total)]));
    const subMap  = new Map(subRows.map(s => [s.organizationId, Number(s.count)]));

    return orgs.map(o => ({
      id:                o.id,
      name:              o.name,
      status:            (o.status ?? "trial") as ClientRow["status"],
      plan:              (o.planId ?? "starter") as ClientRow["plan"],
      docsThisMonth:     docsMap.get(o.id) ?? 0,
      subsidiariesCount: subMap.get(o.id) ?? 0,
      healthScore:       Number(o.healthScore ?? 0),
      lastActive:        relativeDate(o.updatedAt),
    }));
  } catch (err) {
    console.error("[clients] DB error:", err);
    return [];
  }
}

export default async function ClientsPage() {
  const clients = await getClients();

  return (
    <div className="flex-1 flex flex-col">
      {/* Header */}
      <div className="h-14 border-b border-border px-6 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-sm font-semibold text-foreground">Clientes</h1>
          <p className="text-xs text-muted-foreground">
            {clients.length} organización{clients.length !== 1 ? "es" : ""} registrada{clients.length !== 1 ? "s" : ""}
          </p>
        </div>
        <Link
          href="/admin/clients/new"
          className="flex items-center gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Nueva organización
        </Link>
      </div>

      {clients.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center py-24 text-center">
          <div className="w-12 h-12 rounded-2xl bg-card border border-border flex items-center justify-center mb-4">
            <Building2 className="w-5 h-5 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium text-foreground">Sin organizaciones</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-xs">
            Ejecuta <code className="text-primary bg-primary/10 px-1 py-0.5 rounded text-[11px]">npm run seed:demo</code> para poblar con datos de ejemplo
          </p>
        </div>
      ) : (
        <ClientsTable clients={clients} />
      )}
    </div>
  );
}
