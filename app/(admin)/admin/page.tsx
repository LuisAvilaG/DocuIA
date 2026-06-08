import { db } from "@/lib/db";
import {
  organizations, subscriptions, usageDaily,
} from "@/db/schema";
import { eq, desc, gte, sql } from "drizzle-orm";
import { StatCard } from "@/components/admin/stat-card";
import { Building2, FileText, Cpu, TrendingUp } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

const STATUS_STYLES = {
  active:    "bg-success/10 text-success",
  trial:     "bg-warning/10 text-warning",
  suspended: "bg-destructive/10 text-destructive",
  churned:   "bg-secondary text-muted-foreground",
};

const PLAN_STYLES = {
  starter:    "bg-secondary text-muted-foreground",
  growth:     "bg-primary/10 text-primary",
  enterprise: "bg-foreground/10 text-foreground",
};

function HealthBar({ score }: { score: number }) {
  const color = score >= 75 ? "bg-success" : score >= 50 ? "bg-warning" : "bg-destructive";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden max-w-20">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground w-6">{score}</span>
    </div>
  );
}

function relativeDate(date: Date): string {
  const diff = Math.floor((Date.now() - date.getTime()) / 86400000);
  if (diff === 0) return "hoy";
  if (diff === 1) return "ayer";
  if (diff < 7) return `hace ${diff} días`;
  return date.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}

async function getDashboardData() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const monthStart = today.slice(0, 7) + "-01";

    const [orgCounts, todayUsage, yesterdayUsage, recentOrgs, docsPerOrg] =
      await Promise.all([
        db
          .select({
            total:  sql<number>`count(*)::int`,
            trial:  sql<number>`count(*) filter (where status = 'trial')::int`,
            active: sql<number>`count(*) filter (where status = 'active')::int`,
          })
          .from(organizations),

        db
          .select({
            docs:    sql<number>`coalesce(sum(${usageDaily.docsProcessed}), 0)::int`,
            primary: sql<number>`coalesce(sum(${usageDaily.aiPrimaryCalls}), 0)::int`,
            fallback:sql<number>`coalesce(sum(${usageDaily.aiFallbackCalls}), 0)::int`,
          })
          .from(usageDaily)
          .where(eq(usageDaily.date, today)),

        db
          .select({ docs: sql<number>`coalesce(sum(${usageDaily.docsProcessed}), 0)::int` })
          .from(usageDaily)
          .where(eq(usageDaily.date, yesterday)),

        db
          .select({
            id:        organizations.id,
            name:      organizations.name,
            status:    organizations.status,
            planId:    subscriptions.planId,
            updatedAt: organizations.updatedAt,
          })
          .from(organizations)
          .leftJoin(subscriptions, eq(subscriptions.organizationId, organizations.id))
          .orderBy(desc(organizations.createdAt))
          .limit(8),

        db
          .select({
            organizationId: usageDaily.organizationId,
            total: sql<number>`coalesce(sum(${usageDaily.docsProcessed}), 0)::int`,
          })
          .from(usageDaily)
          .where(gte(usageDaily.date, monthStart))
          .groupBy(usageDaily.organizationId),
      ]);

    const sr    = orgCounts[0];
    const tr    = todayUsage[0];
    const yr    = yesterdayUsage[0];
    const docs  = Number(tr?.docs ?? 0);
    const docsY = Number(yr?.docs ?? 0);
    const pri   = Number(tr?.primary ?? 0);
    const fall  = Number(tr?.fallback ?? 0);

    const trend = docsY > 0
      ? `${docs >= docsY ? "+" : ""}${Math.round(((docs - docsY) / docsY) * 100)}%`
      : "—";

    const docsMap = new Map(docsPerOrg.map(d => [d.organizationId, Number(d.total)]));

    function computeHealth(docsMonth: number): number {
      if (docsMonth === 0) return 20;
      if (docsMonth < 10)  return 50;
      if (docsMonth < 50)  return 75;
      if (docsMonth < 200) return 90;
      return 100;
    }

    const healthScores = recentOrgs.map(o => computeHealth(docsMap.get(o.id) ?? 0));
    const avgHealthScore = healthScores.length > 0
      ? Math.round(healthScores.reduce((a, b) => a + b, 0) / healthScores.length)
      : 0;

    return {
      stats: {
        totalOrgs:      Number(sr?.total ?? 0),
        trialOrgs:      Number(sr?.trial ?? 0),
        docsToday:      docs,
        trendValue:     trend,
        trendDir:       docs >= docsY ? "up" : "down" as "up" | "down",
        aiFallbackRate: pri > 0 ? `${Math.round((fall / pri) * 100)}%` : "0%",
        avgHealthScore,
      },
      clients: recentOrgs.map((o, i) => ({
        id:            o.id,
        name:          o.name,
        status:        (o.status ?? "trial") as keyof typeof STATUS_STYLES,
        plan:          (o.planId ?? "starter") as keyof typeof PLAN_STYLES,
        docsThisMonth: docsMap.get(o.id) ?? 0,
        healthScore:   healthScores[i],
        lastActive:    relativeDate(o.updatedAt),
      })),
    };
  } catch (err) {
    console.error("[dashboard] DB error:", err);
    return {
      stats: {
        totalOrgs: 0, trialOrgs: 0, docsToday: 0,
        trendValue: "—", trendDir: "up" as const,
        aiFallbackRate: "—", avgHealthScore: 0,
      },
      clients: [],
    };
  }
}

export default async function AdminDashboardPage() {
  const { stats, clients } = await getDashboardData();

  return (
    <div className="flex-1 flex flex-col">
      {/* Header */}
      <div className="h-14 border-b border-border px-6 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-sm font-semibold text-foreground">Dashboard</h1>
          <p className="text-xs text-muted-foreground">Visión general de la plataforma</p>
        </div>
        <p className="text-[0.6875rem] text-muted-foreground tabular-nums">
          {new Date().toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" })}
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 p-6 space-y-6">

        {/* KPI Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Organizaciones"
            value={stats.totalOrgs}
            sub={`${stats.trialOrgs} en trial`}
            icon={Building2}
            accent="default"
          />
          <StatCard
            label="Documentos hoy"
            value={stats.docsToday.toLocaleString("es-MX")}
            sub="en todas las orgs"
            icon={FileText}
            trend={stats.trendDir}
            trendValue={stats.trendValue}
            accent="success"
          />
          <StatCard
            label="Fallback rate AI"
            value={stats.aiFallbackRate}
            sub="Flash → Pro"
            icon={Cpu}
            accent={stats.aiFallbackRate === "0%" ? "success" : "warning"}
          />
          <StatCard
            label="Health score prom."
            value={`${stats.avgHealthScore}/100`}
            sub="promedio de clientes"
            icon={TrendingUp}
            accent="default"
            tooltip="Mide el progreso de onboarding: 0-49 en riesgo, 50-74 atención, 75-100 saludable"
          />
        </div>

        {/* Recent clients table */}
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <div>
              <h2 className="text-sm font-medium text-foreground">Clientes recientes</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Estado y actividad de todas las organizaciones
              </p>
            </div>
            <Link href="/admin/clients" className="text-xs text-primary hover:text-primary/80 transition-colors">
              Ver todos →
            </Link>
          </div>

          {clients.length === 0 ? (
            <div className="py-16 flex flex-col items-center justify-center text-center">
              <div className="w-10 h-10 rounded-xl bg-muted/50 flex items-center justify-center mb-3">
                <Building2 className="w-5 h-5 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-foreground">Sin clientes aún</p>
              <p className="text-xs text-muted-foreground mt-1">
                Los clientes aparecerán aquí cuando se registren en la plataforma
              </p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  {["Organización", "Plan", "Estado", "Docs/mes", "Health", "Última actividad"].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {clients.map(c => (
                  <tr key={c.id} className="hover:bg-accent/30 transition-colors">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/clients/${c.id}`}
                        className="font-medium text-foreground hover:text-primary transition-colors"
                      >
                        {c.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn("inline-flex items-center px-2 py-0.5 rounded-sm text-xs font-medium", PLAN_STYLES[c.plan])}>
                        {c.plan}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn("inline-flex items-center px-2 py-0.5 rounded-sm text-xs font-medium", STATUS_STYLES[c.status])}>
                        {c.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-foreground">
                      {c.docsThisMonth.toLocaleString("es-MX")}
                    </td>
                    <td className="px-4 py-3">
                      <HealthBar score={c.healthScore} />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {c.lastActive}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
