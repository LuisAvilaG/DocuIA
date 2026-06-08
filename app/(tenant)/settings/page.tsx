import { redirect } from "next/navigation";
import { getTenantSession } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { organizations, orgUsers, subsidiaries, subscriptions, webhooks, expenseCategories, catalogDepartments, catalogClasses } from "@/db/schema";
import { eq, and, count } from "drizzle-orm";
import { getFeature, isFeatureEnabled } from "@/lib/features";
import { SettingsClient } from "./client";

export default async function SettingsPage() {
  const session = await getTenantSession();
  if (!session) redirect("/login");

  try {
    const expenseEnabled = await isFeatureEnabled(session.orgId, "expense_management");

    const [org, users, subs, sub, hooks, dryRunFeature] = await Promise.all([
      db.query.organizations.findFirst({
        where: eq(organizations.id, session.orgId),
      }),

      db
        .select({
          id:          orgUsers.id,
          email:       orgUsers.email,
          fullName:    orgUsers.fullName,
          role:        orgUsers.role,
          isActive:    orgUsers.isActive,
          lastLoginAt: orgUsers.lastLoginAt,
          createdAt:   orgUsers.createdAt,
        })
        .from(orgUsers)
        .where(eq(orgUsers.organizationId, session.orgId)),

      db
        .select({
          id:             subsidiaries.id,
          name:           subsidiaries.name,
          nsSubsidiaryId: subsidiaries.nsSubsidiaryId,
          currency:       subsidiaries.currency,
          locale:         subsidiaries.locale,
          isActive:       subsidiaries.isActive,
          createdAt:      subsidiaries.createdAt,
        })
        .from(subsidiaries)
        .where(eq(subsidiaries.organizationId, session.orgId)),

      db.query.subscriptions.findFirst({
        where: eq(subscriptions.organizationId, session.orgId),
      }),

      db.query.webhooks.findMany({
        where: eq(webhooks.organizationId, session.orgId),
        columns: { secret: false },
      }),

      getFeature(session.orgId, "netsuite_dry_run"),
    ]);

    if (!org) redirect("/login");

    // Expense catalog data (only loaded when feature is active + admin)
    let expenseData: {
      categories: { id: number; name: string; netsuiteAccountName: string | null; dailyCap: string | null; monthlyCap: string | null }[];
      departmentCount: number;
      classCount: number;
      submitterCount: number;
    } | null = null;

    if (expenseEnabled && session.role === "admin") {
      const [cats, deptCount, classCount, submitterCount] = await Promise.all([
        db.select({
          id:                  expenseCategories.id,
          name:                expenseCategories.name,
          netsuiteAccountName: expenseCategories.netsuiteAccountName,
          dailyCap:            expenseCategories.dailyCap,
          monthlyCap:          expenseCategories.monthlyCap,
        }).from(expenseCategories)
          .where(and(eq(expenseCategories.organizationId, session.orgId), eq(expenseCategories.isActive, true)))
          .orderBy(expenseCategories.name),
        db.select({ n: count() }).from(catalogDepartments)
          .where(and(eq(catalogDepartments.organizationId, session.orgId), eq(catalogDepartments.isInactive, false))),
        db.select({ n: count() }).from(catalogClasses)
          .where(and(eq(catalogClasses.organizationId, session.orgId), eq(catalogClasses.isInactive, false))),
        db.select({ n: count() }).from(orgUsers)
          .where(and(eq(orgUsers.organizationId, session.orgId), eq(orgUsers.role, "expense_submitter"))),
      ]);
      expenseData = {
        categories:      cats.map(c => ({ id: c.id, name: c.name, netsuiteAccountName: c.netsuiteAccountName, dailyCap: c.dailyCap, monthlyCap: c.monthlyCap })),
        departmentCount: Number(deptCount[0]?.n ?? 0),
        classCount:      Number(classCount[0]?.n ?? 0),
        submitterCount:  Number(submitterCount[0]?.n ?? 0),
      };
    }

    return (
      <SettingsClient
        org={{
          id:                   org.id,
          name:                 org.name,
          slug:                 org.slug,
          status:               org.status,
          timezone:             org.timezone,
          billingEmail:         org.billingEmail,
          autoProcessThreshold: org.autoProcessThreshold,
          createdAt:            org.createdAt.toISOString(),
        }}
        users={users.map(u => ({
          id:          u.id,
          email:       u.email,
          fullName:    u.fullName,
          role:        u.role,
          isActive:    u.isActive,
          lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
          createdAt:   u.createdAt.toISOString(),
        }))}
        subsidiaries={subs.map(s => ({
          id:             s.id,
          name:           s.name,
          nsSubsidiaryId: s.nsSubsidiaryId,
          currency:       s.currency,
          locale:         s.locale,
          isActive:       s.isActive,
          createdAt:      s.createdAt.toISOString(),
        }))}
        plan={sub?.planId ?? "starter"}
        currentUserRole={session.role ?? "operator"}
        dryRun={dryRunFeature.tenantEnabled}
        dryRunGranted={dryRunFeature.adminGranted}
        webhooks={hooks.map(h => ({
          id:              h.id,
          url:             h.url,
          events:          h.events ?? [],
          isActive:        h.isActive,
          lastTriggeredAt: h.lastTriggeredAt?.toISOString() ?? null,
          lastStatusCode:  h.lastStatusCode ?? null,
          createdAt:       h.createdAt.toISOString(),
        }))}
        expenseData={expenseData}
      />
    );
  } catch (err) {
    console.error("[settings]", err);
    redirect("/dashboard");
  }
}
