import { notFound } from "next/navigation";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { nsConnections, subsidiaries, catalogItems, catalogVendors, catalogLocations, expenseCategories, catalogDepartments, catalogClasses, orgUsers } from "@/db/schema";
import { loadOneOrgFacts } from "@/lib/admin/health";
import { ErpView, type ConnectionRow, type SubsidiaryRow } from "./erp-view";

export default async function ClientErpPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const facts = await loadOneOrgFacts(id);
  if (!facts) notFound();
  const products = new Set(facts.products.filter((p) => p.status !== "disabled").map((p) => p.key));

  const [conns, subs] = await Promise.all([
    db.query.nsConnections.findMany({
      where: eq(nsConnections.organizationId, id),
      columns: { id: true, environment: true, accountId: true, connectionStatus: true, connectionTestedAt: true, connectionError: true, scriptsInstalled: true, catalogScriptId: true, catalogDeployId: true, processScriptId: true, processDeployId: true, updatedAt: true },
    }),
    db.query.subsidiaries.findMany({ where: eq(subsidiaries.organizationId, id) }),
  ]);
  const subIds = subs.map((s) => s.id);
  const count = (t: typeof catalogItems | typeof catalogVendors | typeof catalogLocations) =>
    subIds.length ? db.select({ subsidiaryId: t.subsidiaryId, n: sql<number>`count(*)::int` }).from(t).where(inArray(t.subsidiaryId, subIds)).groupBy(t.subsidiaryId) : Promise.resolve([]);
  const [items, vendors, locations] = await Promise.all([count(catalogItems), count(catalogVendors), count(catalogLocations)]);
  const m = (rows: Array<{ subsidiaryId: string; n: number }>) => new Map(rows.map((r) => [r.subsidiaryId, Number(r.n)]));
  const im = m(items), vm = m(vendors), lm = m(locations);

  let expenses: { categories: number; departments: number; classes: number; employees: number } | null = null;
  if (products.has("expense_management")) {
    const [c, d, k, e] = await Promise.all([
      db.$count(expenseCategories, and(eq(expenseCategories.organizationId, id), eq(expenseCategories.isActive, true))),
      db.$count(catalogDepartments, and(eq(catalogDepartments.organizationId, id), eq(catalogDepartments.isInactive, false))),
      db.$count(catalogClasses, and(eq(catalogClasses.organizationId, id), eq(catalogClasses.isInactive, false))),
      db.$count(orgUsers, and(eq(orgUsers.organizationId, id), eq(orgUsers.role, "expense_submitter"))),
    ]);
    expenses = { categories: c, departments: d, classes: k, employees: e };
  }

  const connections: ConnectionRow[] = conns.map((c) => ({
    environment: c.environment, accountId: c.accountId, status: c.connectionStatus, testedAt: c.connectionTestedAt?.toISOString() ?? null,
    error: c.connectionError, scriptsInstalled: c.scriptsInstalled, catalogScriptId: c.catalogScriptId, catalogDeployId: c.catalogDeployId,
    processScriptId: c.processScriptId, processDeployId: c.processDeployId, updatedAt: c.updatedAt.toISOString(),
  }));
  const subsidiaryRows: SubsidiaryRow[] = subs.map((s) => ({
    id: s.id, name: s.name, nsSubsidiaryId: s.nsSubsidiaryId, currency: s.currency, locale: s.locale, taxId: s.taxId, isActive: s.isActive,
    items: im.get(s.id) ?? 0, vendors: vm.get(s.id) ?? 0, locations: lm.get(s.id) ?? 0,
  }));

  return (
    <ErpView
      orgId={id}
      activeEnvironment={facts.activeNsEnvironment}
      connections={connections}
      subsidiaries={subsidiaryRows}
      hasAp={products.has("ap_automation")}
      expenses={expenses}
    />
  );
}
